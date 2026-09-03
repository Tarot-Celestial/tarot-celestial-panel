// One checkout implementation for both URLs, including maintenance and EUR-only new purchases.
import { POST as checkout } from "../checkout-v2/route";
export const runtime = "nodejs";
export async function POST(req: Request) { return checkout(req); }
