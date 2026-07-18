import os
import json
import uuid
from datetime import date
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, Process, LLM
from db import get_client
import litellm

_original_completion = litellm.completion

def _patched_completion(*args, **kwargs):
    messages = kwargs.get("messages")
    if messages:
        for m in messages:
            if isinstance(m, dict) and "cache_breakpoint" in m:
                del m["cache_breakpoint"]
    return _original_completion(*args, **kwargs)

litellm.completion = _patched_completion

load_dotenv()

llm = LLM(
    model="groq/llama-3.3-70b-versatile",
    api_key=os.environ["GROQ_API_KEY"],
)

def fetch_supply_chain_data():
    """Pull everything the agents need into one JSON blob."""
    db = get_client()
    products = db.table("products").select("*").execute().data
    inventory = db.table("inventory").select("*, products(sku,name,reorder_point)").execute().data
    suppliers = db.table("suppliers").select("*").execute().data
    orders = db.table("orders").select("*, products(sku), suppliers(name)").execute().data
    shipments = db.table("shipments").select("*, orders(id)").execute().data
    return {
        "products": products,
        "inventory": inventory,
        "suppliers": suppliers,
        "orders": orders,
        "shipments": shipments,
    }

def build_crew(data: dict) -> Crew:
    data_str = json.dumps(data, default=str, indent=2)

    demand_analyst = Agent(
        role="Demand Analyst",
        goal="Identify products at risk of stockout based on current inventory vs reorder points.",
        backstory=(
            "You are a supply chain data analyst who specializes in inventory "
            "signals. You flag any product where quantity_on_hand is at or "
            "below its reorder_point."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
    )

    inventory_manager = Agent(
        role="Inventory Manager",
        goal="Recommend reorder quantities and preferred suppliers for flagged products.",
        backstory=(
            "You decide how much to reorder and from which supplier, weighing "
            "supplier reliability_score and avg_lead_time_days."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
    )

    risk_analyst = Agent(
        role="Supplier Risk Analyst",
        goal="Flag suppliers or open orders that pose delivery risk.",
        backstory=(
            "You review supplier reliability scores and any order/shipment "
            "marked delayed, and produce risk warnings."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
    )

    logistics_coordinator = Agent(
        role="Logistics Coordinator",
        goal="Summarize shipment status and any ETA/delay issues into clear action items.",
        backstory=(
            "You track shipments end to end and translate carrier status into "
            "concrete next steps for the operations team."
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
    )

    common_output_instructions = (
        "Respond ONLY with a JSON array (no markdown, no prose) where each "
        "item has: category, product_sku (or null), supplier_name (or null), "
        "message (1-2 sentences), severity ('info'|'warning'|'critical')."
    )

    demand_task = Task(
        description=(
            f"Here is the current supply chain data:\n{data_str}\n\n"
            "Compare each product's inventory quantity_on_hand against its "
            "reorder_point. List every product at or below its reorder point. "
            f"{common_output_instructions} Use category='reorder'."
        ),
        expected_output="JSON array of reorder alerts.",
        agent=demand_analyst,
    )

    inventory_task = Task(
        description=(
            "Using the demand analyst's flagged products, recommend a reorder "
            "quantity (roughly 2x the reorder_point) and pick the best supplier "
            "for that product's category by reliability_score and lead time. "
            f"{common_output_instructions} Use category='restock_plan'."
        ),
        expected_output="JSON array of restock plans.",
        agent=inventory_manager,
        context=[demand_task],
    )

    risk_task = Task(
        description=(
            f"Here is the current supply chain data:\n{data_str}\n\n"
            "Identify suppliers with reliability_score below 0.8, and any "
            "order with status 'delayed'. "
            f"{common_output_instructions} Use category='supplier_risk'."
        ),
        expected_output="JSON array of supplier risk warnings.",
        agent=risk_analyst,
    )

    logistics_task = Task(
        description=(
            f"Here is the current supply chain data:\n{data_str}\n\n"
            "Review all shipments. For any shipment with status 'delayed', "
            "summarize the impact and suggest a next step (e.g. contact "
            f"carrier, notify customer). {common_output_instructions} "
            "Use category='logistics'."
        ),
        expected_output="JSON array of logistics action items.",
        agent=logistics_coordinator,
    )

    return Crew(
        agents=[demand_analyst, inventory_manager, risk_analyst, logistics_coordinator],
        tasks=[demand_task, inventory_task, risk_task, logistics_task],
        process=Process.sequential,
        verbose=True,
    )

def parse_json_safely(raw: str):
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.replace("json\n", "", 1)
    try:
        return json.loads(raw)
    except Exception:
        return []

def run_agents():
    data = fetch_supply_chain_data()
    crew = build_crew(data)
    result = crew.kickoff()

    run_id = str(uuid.uuid4())
    db = get_client()
    all_recs = []

    # crew.kickoff() with sequential process returns the final task's output;
    # to persist all four tasks' outputs, pull each task's raw output:
    for task in crew.tasks:
        parsed = parse_json_safely(task.output.raw if task.output else "[]")
        for rec in parsed:
            row = {
                "run_id": run_id,
                "agent_name": task.agent.role,
                "category": rec.get("category", "general"),
                "product_sku": rec.get("product_sku"),
                "supplier_name": rec.get("supplier_name"),
                "message": rec.get("message", ""),
                "severity": rec.get("severity", "info"),
            }
            all_recs.append(row)

    if all_recs:
        db.table("agent_recommendations").insert(all_recs).execute()

    return {"run_id": run_id, "count": len(all_recs), "recommendations": all_recs}

if __name__ == "__main__":
    output = run_agents()
    print(json.dumps(output, indent=2))