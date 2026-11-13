import { useState, useEffect } from 'react';
import { ProtectedLink } from '../ui/ProtectedMedia';
import {
    FileText, Download, Clock, AlertCircle, FlaskConical, Eye,
    Baby, User, ChevronDown, ChevronUp, ShieldCheck, Calendar
} from 'lucide-react';
import { labAPI } from '../../api';

interface Report {
    _id: string;
    fileUrl: string;
    fileType: string;
    fileName: string;
    fileSize: number;
    uploadedAt: string;
    releasedAt: string | null;
    labTechnicianId?: { firstName: string; lastName: string };
}

interface TestRequest {
    _id: string;
    childId: string;
    childName: string;
    childAge: number;
    testType: string;
    notes: string;
    status: string;
    releasedToParent: boolean;
    createdAt: string;
    updatedAt: string;
    clinicianId?: { firstName: string; lastName: string; email: string };
    reports?: Report[];
}

export function ParentLabReports() {
    const [requests, setRequests] = useState<TestRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        try {
            setLoading(true);
            setError('');
            const { data } = await labAPI.getParentReports();
            setRequests(data.data || []);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load lab reports');
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    };

    const getFileUrl = (fileUrl: string) => {
        const base = (import.meta as any).env?.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:4000';
        return `${base}${fileUrl}`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-3 mb-1">
                    <div className="rounded-xl bg-primary p-2.5 text-primary-foreground">
                        <FlaskConical className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">Lab Reports</h2>
                        <p className="text-muted-foreground text-sm">Reviewed and released lab test reports for your children</p>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 flex items-center gap-2 p-3 bg-muted text-destructive rounded-lg border">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {/* Empty state */}
            {requests.length === 0 ? (
                <div className="bg-card rounded-xl shadow-sm border p-16 text-center">
                    <FlaskConical className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No lab reports available yet</p>
                    <p className="text-muted-foreground text-sm mt-1">
                        When your clinician reviews and releases lab test reports, they will appear here.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Summary banner */}
                    <div className="flex items-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg border-blue-200">
                        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                        <span className="text-sm font-medium">
                            {requests.length} report{requests.length !== 1 ? 's' : ''} reviewed and released by your clinician
                        </span>
                    </div>

                    {requests.map((request) => {
                        const isExpanded = expandedId === request._id;

                        return (
                            <div
                                key={request._id}
                                className="bg-card rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-shadow"
                            >
                                {/* Summary row */}
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : request._id)}
                                    className="w-full flex items-center gap-4 p-5 text-left hover:bg-muted transition-colors"
                                >
                                    {/* Test type icon */}
                                    <div className="p-2.5 rounded-lg bg-gradient-to-br from-blue-50 to-blue-50 flex-shrink-0">
                                        <FlaskConical className="w-5 h-5 text-blue-600" />
                                    </div>

                                    {/* Main info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-semibold text-foreground">{request.testType}</span>
                                            <span className="text-muted-foreground">·</span>
                                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                                                <Baby className="w-3.5 h-3.5" />
                                                {request.childName}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                Released {formatDate(request.updatedAt)}
                                            </span>
                                            {request.reports && request.reports.length > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <FileText className="w-3 h-3" />
                                                    {request.reports.length} file{request.reports.length > 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Status badge */}
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-blue-50 text-blue-700 border-blue-200">
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        Reviewed & Released
                                    </span>

                                    {/* Expand icon */}
                                    {isExpanded ? (
                                        <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                                    ) : (
                                        <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                                    )}
                                </button>

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div className="border-t border bg-muted/50 p-5">
                                        <div className="space-y-5">
                                            {/* Info cards */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {/* Child info */}
                                                <div className="bg-card rounded-lg border p-4">
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <Baby className="w-4 h-4 text-blue-600" />
                                                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Child</span>
                                                    </div>
                                                    <p className="text-sm font-medium text-foreground">{request.childName}</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">{request.childAge} years old</p>
                                                </div>

                                                {/* Clinician info */}
                                                <div className="bg-card rounded-lg border p-4">
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <User className="w-4 h-4 text-blue-600" />
                                                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reviewed By</span>
                                                    </div>
                                                    {request.clinicianId ? (
                                                        <>
                                                            <p className="text-sm font-medium text-foreground">
                                                                Dr. {request.clinicianId.firstName} {request.clinicianId.lastName}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground mt-0.5">{request.clinicianId.email}</p>
                                                        </>
                                                    ) : (
                                                        <p className="text-sm text-muted-foreground">Not available</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Notes */}
                                            {request.notes && (
                                                <div className="bg-card rounded-lg border p-4">
                                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Clinician's Notes</p>
                                                    <p className="text-sm text-foreground">{request.notes}</p>
                                                </div>
                                            )}

                                            {/* Report files */}
                                            {request.reports && request.reports.length > 0 ? (
                                                <div>
                                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                                                        Report Files ({request.reports.length})
                                                    </p>
                                                    <div className="space-y-2">
                                                        {request.reports.map(report => (
                                                            <div key={report._id} className="flex items-center gap-3 bg-card rounded-lg border p-3">
                                                                <div className="p-2 rounded-lg bg-blue-50">
                                                                    <FileText className="w-4 h-4 text-blue-600" />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-medium text-foreground truncate">{report.fileName}</p>
                                                                    <p className="text-xs text-muted-foreground">
                                                                        {formatFileSize(report.fileSize)} · Uploaded {formatDate(report.uploadedAt)}
                                                                        {report.releasedAt && (
                                                                            <> · Released {formatDate(report.releasedAt)}</>
                                                                        )}
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <ProtectedLink
                                                                        href={getFileUrl(report.fileUrl)}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors border-blue-200"
                                                                    >
                                                                        <Eye className="w-3.5 h-3.5" />
                                                                        View
                                                                    </ProtectedLink>
                                                                    <ProtectedLink
                                                                        href={getFileUrl(report.fileUrl)}
                                                                        download={report.fileName}
                                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-muted rounded-lg hover:bg-muted transition-colors border"
                                                                    >
                                                                        <Download className="w-3.5 h-3.5" />
                                                                        Download
                                                                    </ProtectedLink>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-center py-6 bg-card rounded-lg border">
                                                    <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                                                    <p className="text-sm text-muted-foreground">No report files available</p>
                                                </div>
                                            )}

                                            {/* Released confirmation banner */}
                                            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border-blue-200">
                                                <ShieldCheck className="w-4 h-4 text-blue-600" />
                                                <span className="text-sm text-blue-700 font-medium">
                                                    This report has been reviewed and released by your clinician
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
