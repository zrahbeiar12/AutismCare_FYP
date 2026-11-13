import { useState, useEffect, useRef } from 'react';
import { ProtectedLink } from '../ui/ProtectedMedia';
import {
    ArrowLeft, Upload, FileText, User, Stethoscope, Baby,
    Clock, CheckCircle, AlertCircle, X, FileUp
} from 'lucide-react';
import { labAPI } from '../../api';
import { CaseStatusBadge } from '../CaseStatusBadge';

interface LabTestRequestDetailProps {
    requestId: string | null;
    onBack: () => void;
}

interface RequestData {
    _id: string;
    childId: string;
    childName: string;
    childAge: number;
    testType: string;
    notes: string;
    status: string;
    caseId?: string;
    caseStatus?: string;
    releasedToParent: boolean;
    createdAt: string;
    updatedAt: string;
    clinicianId?: { firstName: string; lastName: string; email: string; specialization?: string };
    parentId?: { firstName: string; lastName: string; email: string; phoneNumber?: string };
    reports?: Array<{
        _id: string;
        fileUrl: string;
        fileType: string;
        fileName: string;
        fileSize: number;
        uploadedAt: string;
        releasedAt: string | null;
        labTechnicianId?: { firstName: string; lastName: string };
    }>;
}

const statusConfig: Record<string, { color: string; bg: string; border: string; icon: any }> = {
    PENDING: { color: 'text-accent-foreground', bg: 'bg-accent/10', border: 'border-border', icon: Clock },
    UPLOADED: { color: 'text-primary', bg: 'bg-secondary/60', border: 'border-border', icon: FileUp },
    RELEASED: { color: 'text-primary', bg: 'bg-secondary', border: 'border-border', icon: CheckCircle },
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];

export function LabTestRequestDetail({ requestId, onBack }: LabTestRequestDetailProps) {
    const [request, setRequest] = useState<RequestData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Upload state
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (requestId) fetchRequest();
    }, [requestId]);

    const fetchRequest = async () => {
        try {
            setLoading(true);
            setError('');
            const { data } = await labAPI.getRequestById(requestId);
            setRequest(data.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load request details');
        } finally {
            setLoading(false);
        }
    };

    // ---------- File handling ----------
    const validateFile = (file: File): string | null => {
        if (!ALLOWED_TYPES.includes(file.type)) {
            return 'Invalid file type. Only PDF, JPG, and PNG files are allowed.';
        }
        if (file.size > MAX_FILE_SIZE) {
            return `File size exceeds 25MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB).`;
        }
        return null;
    };

    const handleFileSelect = (file: File) => {
        const error = validateFile(file);
        if (error) {
            setUploadError(error);
            setSelectedFile(null);
            return;
        }
        setUploadError('');
        setUploadSuccess('');
        setSelectedFile(file);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileSelect(file);
    };

    // Drag & drop handlers
    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileSelect(file);
    };

    // Upload handler
    const handleUpload = async () => {
        if (!selectedFile || !requestId) return;

        const formData = new FormData();
        formData.append('report', selectedFile);
        formData.append('testRequestId', requestId);
        // Server state gate requires caseId (single source of truth).
        if (request && (request as any).caseId) {
            formData.append('caseId', String((request as any).caseId));
        }

        try {
            setUploading(true);
            setUploadError('');
            setUploadProgress(0);

            await labAPI.uploadReport(formData, (progressEvent: any) => {
                const percentCompleted = Math.round(
                    (progressEvent.loaded * 100) / progressEvent.total
                );
                setUploadProgress(percentCompleted);
            });

            setUploadSuccess('Report uploaded successfully! Notifications have been sent.');
            setSelectedFile(null);
            setUploadProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';

            // Refresh the request data to see the new report
            await fetchRequest();
        } catch (err: any) {
            setUploadError(err.response?.data?.message || 'Failed to upload report');
        } finally {
            setUploading(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    };

    // ---------- Render ----------
    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error || !request) {
        return (
            <div className="text-center py-20">
                <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
                <p className="text-destructive font-medium">{error || 'Request not found'}</p>
                <button onClick={onBack} className="mt-4 text-sm text-primary hover:underline font-medium">
                    ← Back to requests
                </button>
            </div>
        );
    }

    const statusCfg = statusConfig[request.status] || statusConfig.PENDING;
    const StatusIcon = statusCfg.icon;

    return (
        <div>
            {/* Back button + header */}
            <div className="flex items-center gap-4 mb-6">
                <button
                    onClick={onBack}
                    className="p-2 rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-foreground">Test Request Details</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Request ID: {request._id}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`}>
                    <StatusIcon className="w-4 h-4" />
                    {request.status}
                </span>
            </div>
            {request.caseStatus ? (
                <div className="mb-6">
                    <CaseStatusBadge status={request.caseStatus} />
                </div>
            ) : null}

            {/* Info cards row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                {/* Child Info */}
                <div className="bg-card rounded-xl shadow-sm border p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 rounded-lg bg-secondary">
                            <Baby className="w-5 h-5 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Child Information</h3>
                    </div>
                    <div className="space-y-3 mt-1">
                        <div>
                            <p className="text-xs text-muted-foreground">Name</p>
                            <p className="text-sm font-medium text-foreground">{request.childName}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Age</p>
                            <p className="text-sm font-medium text-foreground">{request.childAge} years</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Child ID</p>
                            <p className="text-xs font-mono text-muted-foreground">{request.childId}</p>
                        </div>
                    </div>
                </div>

                {/* Clinician Info */}
                <div className="bg-card rounded-xl shadow-sm border p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 rounded-lg bg-secondary">
                            <Stethoscope className="w-5 h-5 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Clinician</h3>
                    </div>
                    {request.clinicianId ? (
                        <div className="space-y-3 mt-1">
                            <div>
                                <p className="text-xs text-muted-foreground">Name</p>
                                <p className="text-sm font-medium text-foreground">
                                    {request.clinicianId.firstName} {request.clinicianId.lastName}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Email</p>
                                <p className="text-sm text-muted-foreground">{request.clinicianId.email}</p>
                            </div>
                            {request.clinicianId.specialization && (
                                <div>
                                    <p className="text-xs text-muted-foreground">Specialization</p>
                                    <p className="text-sm text-muted-foreground">{request.clinicianId.specialization}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">Not available</p>
                    )}
                </div>

                {/* Parent Info */}
                <div className="bg-card rounded-xl shadow-sm border p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 rounded-lg bg-muted">
                            <User className="w-5 h-5 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Parent / Guardian</h3>
                    </div>
                    {request.parentId ? (
                        <div className="space-y-3 mt-1">
                            <div>
                                <p className="text-xs text-muted-foreground">Name</p>
                                <p className="text-sm font-medium text-foreground">
                                    {request.parentId.firstName} {request.parentId.lastName}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Email</p>
                                <p className="text-sm text-muted-foreground">{request.parentId.email}</p>
                            </div>
                            {request.parentId.phoneNumber && (
                                <div>
                                    <p className="text-xs text-muted-foreground">Phone</p>
                                    <p className="text-sm text-muted-foreground">{request.parentId.phoneNumber}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">Not available</p>
                    )}
                </div>
            </div>

            {/* Test Details */}
            <div className="bg-card rounded-xl shadow-sm border p-6 mb-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">Test Details</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                        <p className="text-xs text-muted-foreground">Test Type</p>
                        <span className="inline-flex mt-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-muted text-foreground">
                            {request.testType}
                        </span>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Requested On</p>
                        <p className="text-sm text-foreground mt-1">{formatDate(request.createdAt)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Last Updated</p>
                        <p className="text-sm text-foreground mt-1">{formatDate(request.updatedAt)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Released to Parent</p>
                        <p className="text-sm text-foreground mt-1">{request.releasedToParent ? 'Yes' : 'No'}</p>
                    </div>
                </div>
                {request.notes && (
                    <div className="mt-4 pt-4 border-t border">
                        <p className="text-xs text-muted-foreground mb-1">Clinician Notes</p>
                        <p className="text-sm text-foreground bg-muted rounded-lg p-3">{request.notes}</p>
                    </div>
                )}
            </div>

            {/* Upload Section (only show if status is PENDING) */}
            {request.status === 'PENDING' && (
                <div className="bg-card rounded-xl shadow-sm border p-6 mb-6">
                    <h3 className="text-sm font-semibold text-foreground mb-4">Upload Lab Report</h3>

                    {/* Drag & Drop Zone */}
                    <div
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragActive
                            ? 'border-primary bg-secondary/30'
                            : 'border-border hover:border-primary/40 hover:bg-muted'
                            }`}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleInputChange}
                            className="hidden"
                        />
                        <Upload className={`w-10 h-10 mx-auto mb-3 ${dragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                        <p className="text-sm font-medium text-foreground">
                            {dragActive ? 'Drop your file here' : 'Drag & drop a file here, or click to browse'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — Max 25MB</p>
                    </div>

                    {/* Selected file preview */}
                    {selectedFile && (
                        <div className="mt-4 flex items-center gap-3 p-3 bg-muted rounded-lg border">
                            <FileText className="w-8 h-8 text-primary flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{selectedFile.name}</p>
                                <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFile(null);
                                    setUploadError('');
                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                }}
                                className="p-1 rounded-full hover:bg-muted transition-colors"
                            >
                                <X className="w-4 h-4 text-muted-foreground" />
                            </button>
                        </div>
                    )}

                    {/* Progress bar */}
                    {uploading && (
                        <div className="mt-4">
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>Uploading...</span>
                                <span>{uploadProgress}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                                <div
                                    className="h-2 rounded-full bg-primary transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {/* Success message */}
                    {uploadSuccess && (
                        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-primary">
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="text-sm">{uploadSuccess}</span>
                        </div>
                    )}

                    {/* Error message */}
                    {uploadError && (
                        <div className="mt-4 flex items-center gap-2 p-3 bg-muted text-destructive rounded-lg border">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="text-sm">{uploadError}</span>
                        </div>
                    )}

                    {/* Upload button */}
                    <button
                        onClick={handleUpload}
                        disabled={!selectedFile || uploading}
                        className="mt-4 flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {uploading ? 'Uploading...' : 'Upload Report'}
                    </button>
                </div>
            )}

            {/* Existing Reports */}
            {request.reports && request.reports.length > 0 && (
                <div className="bg-card rounded-xl shadow-sm border p-6">
                    <h3 className="text-sm font-semibold text-foreground mb-4">
                        Uploaded Reports ({request.reports.length})
                    </h3>
                    <div className="space-y-3">
                        {request.reports.map((report) => (
                            <div key={report._id} className="flex items-center gap-4 p-3 bg-muted rounded-lg border">
                                <div className="p-2 rounded-lg bg-secondary">
                                    <FileText className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{report.fileName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatFileSize(report.fileSize)} · Uploaded {formatDate(report.uploadedAt)}
                                        {report.labTechnicianId && (
                                            <> · by {report.labTechnicianId.firstName} {report.labTechnicianId.lastName}</>
                                        )}
                                    </p>
                                </div>
                                <ProtectedLink
                                    href={`${import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:4000'}${report.fileUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-secondary/80"
                                >
                                    View
                                </ProtectedLink>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
