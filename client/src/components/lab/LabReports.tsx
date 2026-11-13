import { useState, useEffect } from 'react';
import { ProtectedLink } from '../ui/ProtectedMedia';
import { FileText, Download, Clock, CheckCircle, AlertCircle, Search } from 'lucide-react';
import { labAPI } from '../../api';

interface Report {
    _id: string;
    testRequestId: { _id: string; childName: string; testType: string; status: string };
    childId: string;
    fileUrl: string;
    fileType: string;
    fileName: string;
    fileSize: number;
    uploadedAt: string;
    releasedAt: string | null;
    clinicianId?: { firstName: string; lastName: string };
    labTechnicianId?: { firstName: string; lastName: string };
}

export function LabReports() {
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        try {
            setLoading(true);
            setError('');
            const { data } = await labAPI.getAllReports();
            setReports(data.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load reports');
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

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="mb-6">
                <h2 className="text-3xl font-bold text-foreground tracking-tight">Lab Reports</h2>
                <p className="text-muted-foreground mt-1">All uploaded laboratory reports</p>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 flex items-center gap-3 p-4 bg-muted text-destructive rounded-lg border">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Reports Grid */}
            {reports.length === 0 ? (
                <div className="bg-card rounded-xl shadow-sm border p-16 text-center">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No reports uploaded yet</p>
                    <p className="text-muted-foreground text-sm mt-1">Reports will appear here after uploading from test requests</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {reports.map((report) => (
                        <div key={report._id} className="bg-card rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow">
                            {/* File icon + name */}
                            <div className="flex items-start gap-3 mb-4">
                                <div className="flex-shrink-0 rounded-lg bg-secondary p-2.5">
                                    <FileText className="w-6 h-6 text-primary" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-foreground truncate">{report.fileName}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{formatFileSize(report.fileSize)}</p>
                                </div>
                            </div>

                            {/* Metadata */}
                            <div className="space-y-3 mb-4">
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Child</span>
                                    <span className="text-foreground font-medium">{report.testRequestId.childName}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Test Type</span>
                                    <span className="inline-flex px-2 py-0.5 rounded text-xs bg-muted text-foreground font-medium">
                                        {report.testRequestId.testType}
                                    </span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Status</span>
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${report.testRequestId.status === 'RELEASED'
                                        ? 'bg-secondary text-primary'
                                        : report.testRequestId.status === 'UPLOADED'
                                            ? 'bg-secondary/70 text-primary'
                                            : 'bg-accent/10 text-accent-foreground'
                                        }`}>
                                        {report.testRequestId.status}
                                    </span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Uploaded</span>
                                    <span className="text-muted-foreground">{formatDate(report.uploadedAt)}</span>
                                </div>
                                {report.releasedAt && (
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Released</span>
                                        <span className="text-primary">{formatDate(report.releasedAt)}</span>
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <ProtectedLink
                                href={`${import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:4000'}${report.fileUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary/80"
                            >
                                <Download className="w-4 h-4" />
                                View / Download
                            </ProtectedLink>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
