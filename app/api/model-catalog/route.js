import { NextResponse } from "next/server";
import { listModelCatalog, refreshModelCatalog } from "../../../src/model-catalog.js";

export async function GET(request) {
  try {
    const shouldRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (shouldRefresh) {
      await refreshModelCatalog();
    }
    return NextResponse.json(await listModelCatalog());
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
