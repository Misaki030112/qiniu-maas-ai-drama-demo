import { NextResponse } from "next/server";
import { listModelCatalog } from "../../../src/model-catalog.js";

export async function GET() {
  try {
    return NextResponse.json(await listModelCatalog());
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
