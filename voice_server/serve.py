"""
NetworQ Realtime Voice Server
Low-latency real-time voice intelligence with NetworQ CRM Tools.
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from typing import Optional

# Ensure local extracted speech-to-speech package is on Python module path
current_dir = Path(__file__).resolve().parent
extracted_src = current_dir / "speech-to-speech-main" / "src"
if extracted_src.exists() and str(extracted_src) not in sys.path:
    sys.path.insert(0, str(extracted_src))

# Safe .env loader without requiring external dotenv package
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    env_file = current_dir.parent / ".env"
    if env_file.exists():
        with open(env_file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))

# System prompt defining Q's executive persona & NetworQ tool capabilities
Q_SYSTEM_PROMPT = """You are Q, the executive voice intelligence for NetworQ (an executive networking and CRM platform).
You assist founders, investors, and business leaders in real time.
Be articulate, concise (1-2 sentences maximum), confident, and warm.
You have access to tools for drafting follow-up emails, scheduling Google Meet invitations, scanning business cards, discovering verified summits, and searching contacts.
Execute tools immediately when requested.
"""

# NetworQ Tool Definitions for the Speech-to-Speech Engine
NETWORQ_TOOLS = [
    {
        "type": "function",
        "name": "draft_email",
        "description": "Draft a personalized follow-up or outreach email to a business contact and open the NetworQ composer.",
        "parameters": {
            "type": "object",
            "properties": {
                "contact_name": {"type": "string", "description": "The name of the contact to email."},
                "custom_angle": {"type": "string", "description": "Optional focus or topic (e.g. strategic partnership, investment)."}
            },
            "required": ["contact_name"]
        }
    },
    {
        "type": "function",
        "name": "schedule_meeting",
        "description": "Open Google Meet / calendar scheduler pre-filled for a contact.",
        "parameters": {
            "type": "object",
            "properties": {
                "contact_name": {"type": "string", "description": "Name of the attendee to schedule meeting with."}
            },
            "required": ["contact_name"]
        }
    },
    {
        "type": "function",
        "name": "scan_business_card",
        "description": "Open the live camera viewfinder or OCR scanner to scan physical cards into CRM.",
        "parameters": {"type": "object", "properties": {}}
    },
    {
        "type": "function",
        "name": "filter_summits",
        "description": "Filter business summits and conferences by city or timeframe.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name (e.g. Hyderabad, Bengaluru, San Francisco)."},
                "timeframe": {"type": "string", "enum": ["all", "today", "weekend", "trending"]}
            }
        }
    },
    {
        "type": "function",
        "name": "open_radar",
        "description": "Activate the live perimeter radar room to detect nearby conference attendees.",
        "parameters": {"type": "object", "properties": {}}
    },
    {
        "type": "function",
        "name": "search_contacts",
        "description": "Search CRM contacts by name, company, tag, or industry.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query."}
            },
            "required": ["query"]
        }
    }
]

def main():
    port = os.getenv("PORT", "8765")
    host = os.getenv("HOST", "0.0.0.0")
    print(f"🚀 Starting NetworQ Voice Engine on ws://{host}:{port}/v1/realtime")
    print(f"✨ NetworQ Executive Voice Intelligence Active.")

    try:
        from speech_to_speech.s2s_pipeline import run_pipeline_command
        args = ["--host", host, "--port", str(port)]
        if len(sys.argv) > 1:
            args.extend(sys.argv[1:])
        run_pipeline_command("serve", args)
    except ImportError as e:
        print(f"\n⚠️ Missing dependency: {e}")
        print("To install required packages, run:")
        print("   pip3 install -r voice_server/speech-to-speech-main/pyproject.toml")
        print("   python3 voice_server/serve.py\n")
    except Exception as e:
        print(f"\n❌ Error starting server: {e}")

if __name__ == "__main__":
    main()
