export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseYM, buildBulkPlanWorkbook } from "@/lib/plan-template";

// ค่าเริ่มต้นรอบวางแผนนี้: Actual มิ.ย.–ก.ย. 2026, แผนตั้งแต่ ต.ค. 2026 ถึงวันจบโครงการ
const DEFAULT_ACTUAL_FROM = "2026-06";
const DEFAULT_ACTUAL_TO   = "2026-09";
const DEFAULT_PLAN_FROM   = "2026-10";

/**
 * Template แผนรายคนของหลายโครงการ (1 sheet ต่อโครงการ) ให้ PD กรอกแล้วส่งกลับมา import
 * ?group=solar|wind|gas|datacenter|procurement|other|all  (ไม่รวม Overhead เสมอ)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "md"].includes((session.user as any).role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const group = searchParams.get("group") || "all";
  const actualFrom = parseYM(searchParams.get("actualFrom") || DEFAULT_ACTUAL_FROM);
  const actualTo   = parseYM(searchParams.get("actualTo") || DEFAULT_ACTUAL_TO);
  const planFrom   = parseYM(searchParams.get("planFrom") || DEFAULT_PLAN_FROM);
  if (!actualFrom || !actualTo || !planFrom) return NextResponse.json({ error: "รูปแบบเดือนต้องเป็น yyyy-MM" }, { status: 400 });

  const wb = await buildBulkPlanWorkbook(group, actualFrom, actualTo, planFrom);
  if (!wb) return NextResponse.json({ error: "ไม่พบโครงการในกลุ่มนี้" }, { status: 404 });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `PlanTemplate_${group}_${planFrom.year}-${String(planFrom.month).padStart(2, "0")}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
