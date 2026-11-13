import { UserManagementTable } from '../components/admin/UserManagementTable';
import { OrganizationsPanel } from '../components/admin/OrganizationsPanel';
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Calendar, Clock, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import {
  DashboardCard,
  DashboardPageHeader,
  DashboardSection,
  EmptyState,
} from "../components/layout/DashboardPatterns";
import ApprovalRequests from "../components/admin/ApprovalRequests";
import { AdminAppointments } from "../components/admin/AdminAppointments";
import { clinicalIntelligenceAPI, adminAPI } from "../api";

function AdminClinicalIQ() {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [payload, setPayload] = React.useState(null);
  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await clinicalIntelligenceAPI.getGlobalClinicalSummary();
      setPayload(data?.data ?? null);
    } catch (e) {
      setErr(e?.response?.data?.message || "Failed to load clinical intelligence summary");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? "Loading…" : "Refresh 30-day aggregates"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {payload && (
        <pre className="max-h-[480px] overflow-auto rounded-lg border bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

const navigation = [
  { id: "approvals", label: "Pending Approvals", icon: Clock },
  { id: "appointments", label: "Appointments", icon: Calendar },
  { id: "clinical-iq", label: "Clinical IQ", icon: TrendingUp },
  { id: "users", label: "User Management", icon: Users },
  { id: "organizations", label: "Organisations", icon: Building2 },
];

const menuItems = {
  approvals: ApprovalRequests,
  appointments: AdminAppointments,
  "clinical-iq": AdminClinicalIQ,
  users: UserManagementTable,
  organizations: OrganizationsPanel,
};

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("approvals");
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const { data } = await adminAPI.getDashboardMetrics();
        if (!cancelled) setMetrics(data?.data ?? null);
      } catch (e) {
        if (!cancelled) {
          setMetricsError(e?.response?.data?.message || "Could not load metrics");
          setMetrics(null);
        }
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    navigate('/login');
  };

  const ActiveComponent = menuItems[activeTab];

  const pendingApprovalsLabel = metricsLoading ? "…" : metricsError ? "—" : String(metrics?.pendingApprovals ?? "—");
  const apptPendingLabel = metricsLoading ? "…" : metricsError ? "—" : String(metrics?.appointmentsPending ?? "—");
  const staffLabel = metricsLoading ? "…" : metricsError ? "—" : String(metrics?.activeProfessionals ?? "—");
  const completedLabel = metricsLoading ? "…" : metricsError ? "—" : String(metrics?.appointmentsCompleted ?? "—");

  return (
    <DashboardLayout
      navigation={navigation}
      currentSection={activeTab}
      onSectionChange={setActiveTab}
      onLogout={handleLogout}
      title="Admin Dashboard"
    >
      <DashboardPageHeader
        title={navigation.find((item) => item.id === activeTab)?.label || "Admin Dashboard"}
        description="Manage operational tasks with a clear, healthcare-focused interface."
      />

      {metricsError ? (
        <p className="mb-4 text-sm text-amber-800">{metricsError}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardCard
          title="Pending Approvals"
          description="Professionals awaiting review"
          value={pendingApprovalsLabel}
          icon={<Clock className="h-4 w-4" />}
        />
        <DashboardCard
          title="Appointments"
          description="Requests pending professional action"
          value={apptPendingLabel}
          icon={<Calendar className="h-4 w-4" />}
        />
        <DashboardCard
          title="Active Staff"
          description="Approved clinicians, therapists, and labs"
          value={staffLabel}
          icon={<Users className="h-4 w-4" />}
        />
        <DashboardCard
          title="Completed Appointments"
          description="All-time completed visits (system)"
          value={completedLabel}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-6">
        <DashboardSection
          tone={
            activeTab === "approvals"
              ? "yellow"
              : activeTab === "appointments"
                ? "blue"
                : activeTab === "clinical-iq"
                  ? "green"
                  : "green"
          }
          title={navigation.find((item) => item.id === activeTab)?.label}
          description="Review and manage key items with clear status visibility."
        >
          {ActiveComponent && <ActiveComponent />}
        </DashboardSection>
      </div>
    </DashboardLayout>
  );
}
