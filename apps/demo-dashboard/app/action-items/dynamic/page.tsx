import { ActionItemsPanel } from "../../../components/ActionItemsPanel";
import { getFrontendDashboardData } from "../../../lib/frontend-dashboard-data";

export default function DynamicActionItemsPage() {
  const data = getFrontendDashboardData();

  return (
    <ActionItemsPanel
      actionItems={data.actionItems}
      vulnerabilities={data.vulnerabilities}
      dataLabel="Dynamic testdata"
    />
  );
}
