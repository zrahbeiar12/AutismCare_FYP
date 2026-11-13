import { openProtectedFile } from '../../utils/protectedFile';
import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { CheckCircle, XCircle, Clock, User, Stethoscope, Users, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import API from "../../api";
import { resolveUploadsHref } from "../../utils/resolveUploadsUrl";

interface Document {
  name: string;
  url: string;
  type: string;
  uploadedAt: string;
}

interface PendingUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  specialization?: string;
  licenseNumber?: string;
  labName?: string;
  accreditation?: string;
  documents?: Document[];
  createdAt: string;
}

const roleConfig = {
  clinician: { icon: Stethoscope, label: "Clinician", color: "bg-secondary/70 text-primary" },
  therapist: { icon: Users, label: "Therapist", color: "bg-secondary text-primary" },
  lab: { icon: FlaskConical, label: "Lab", color: "bg-secondary text-primary" }
};

export default function ApprovalRequests() {
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingUsers();
  }, []);

  const fetchPendingUsers = async () => {
    try {
      const response = await API.get("/admin/pending-professionals");
      setPendingUsers(response.data.users);
    } catch (error) {
      console.error("Error fetching pending users:", error);
      toast.error("Failed to load pending approvals");
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (userId: string, status: "active" | "rejected") => {
    setProcessing(userId);
    try {
      await API.post("/admin/update-professional-status", {
        userId,
        status,
      });

      toast.success(`Professional ${status === "active" ? "approved" : "rejected"} successfully`);

      // Remove from pending list
      setPendingUsers(prev => prev.filter(user => user._id !== userId));
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Clock className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-foreground">Pending Approvals</h2>
        <Badge variant="secondary" className="ml-auto">
          {pendingUsers.length} pending
        </Badge>
      </div>

      {pendingUsers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-12 w-12 text-primary mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">All caught up!</h3>
            <p className="text-muted-foreground text-center">
              No pending approvals at this time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pendingUsers.map((user) => {
            const config = roleConfig[user.role as keyof typeof roleConfig];
            const Icon = config?.icon || User;

            return (
              <Card key={user._id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-lg">
                          {user.firstName} {user.lastName}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                    <Badge className={config?.color || "bg-muted text-foreground"}>
                      {config?.label || user.role}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-3">
                    {user.specialization && (
                      <div>
                        <span className="text-sm font-medium text-foreground">Specialization:</span>
                        <span className="text-sm text-muted-foreground ml-2">{user.specialization}</span>
                      </div>
                    )}

                    {user.licenseNumber && (
                      <div>
                        <span className="text-sm font-medium text-foreground">License Number:</span>
                        <span className="text-sm text-muted-foreground ml-2">{user.licenseNumber}</span>
                      </div>
                    )}

                    {user.role === 'lab' && (
                      <>
                        {user.labName && (
                          <div>
                            <span className="text-sm font-medium text-foreground">Lab Name:</span>
                            <span className="text-sm text-muted-foreground ml-2">{user.labName}</span>
                          </div>
                        )}
                        {user.accreditation && (
                          <div>
                            <span className="text-sm font-medium text-foreground">Accreditation:</span>
                            <span className="text-sm text-muted-foreground ml-2">{user.accreditation}</span>
                          </div>
                        )}
                      </>
                    )}

                    {user.documents && user.documents.length > 0 && (
                      <div>
                        <span className="text-sm font-medium text-foreground">Documents:</span>
                        <div className="mt-2 space-y-2">
                          {user.documents.map((doc, index) => (
                            <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground">{doc.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {doc.type} • Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                                </p>
                              </div>
                              <Button
                                onClick={() => openProtectedFile(doc.url).catch(() => toast.error('Could not open this document'))}
                                variant="outline"
                                size="sm"
                                className="text-xs"
                              >
                                View
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <span className="text-sm font-medium text-foreground">Applied:</span>
                      <span className="text-sm text-muted-foreground ml-2">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={() => handleApproval(user._id, "active")}
                        disabled={processing === user._id}
                        variant="default"
                        size="sm"
                      >
                        {processing === user._id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-2" />
                        )}
                        Approve
                      </Button>

                      <Button
                        onClick={() => handleApproval(user._id, "rejected")}
                        disabled={processing === user._id}
                        variant="destructive"
                        size="sm"
                      >
                        {processing === user._id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        ) : (
                          <XCircle className="h-4 w-4 mr-2" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
