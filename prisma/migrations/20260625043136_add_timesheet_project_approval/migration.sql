-- CreateTable
CREATE TABLE "TimesheetProjectApproval" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetProjectApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetProjectApproval_timesheetId_projectId_key" ON "TimesheetProjectApproval"("timesheetId", "projectId");
