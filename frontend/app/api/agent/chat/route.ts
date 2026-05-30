import { NextResponse } from "next/server";

import { runResearchAgent } from "../../../../lib/agents/research-agent";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await runResearchAgent(payload);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent request failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

