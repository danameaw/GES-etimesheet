-- CreateTable
CREATE TABLE "TimesheetFavorite" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskCodeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetFavorite_employeeId_projectId_taskCodeId_key" ON "TimesheetFavorite"("employeeId", "projectId", "taskCodeId");

-- AddForeignKey
ALTER TABLE "TimesheetFavorite" ADD CONSTRAINT "TimesheetFavorite_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetFavorite" ADD CONSTRAINT "TimesheetFavorite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetFavorite" ADD CONSTRAINT "TimesheetFavorite_taskCodeId_fkey" FOREIGN KEY ("taskCodeId") REFERENCES "TaskCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
