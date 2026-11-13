import * as React from 'react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Search, CheckCircle, XCircle, RotateCcw, Ban } from 'lucide-react';
import API from '../../api';
import { fetchOrganizations, type Organization } from './OrganizationsPanel';

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  approvalStatus?: string;
  specialization?: string;
  createdAt: string;
  organizationId?: string | null;
}

const ALL = 'all';
const PROFESSIONAL_ROLES = ['clinician', 'therapist', 'lab'];

export function UserManagementTable() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);

  useEffect(() => {
    fetchOrganizations().then(setOrgs).catch(() => setOrgs([]));
  }, []);

  const setOrganization = async (userId: string, organizationId: string) => {
    setBusyId(userId);
    try {
      await API.put(`/admin/users/${userId}/organization`, { organizationId });
      await fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to assign organisation');
    } finally {
      setBusyId(null);
    }
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchUsers();
  }, [currentPage, roleFilter, statusFilter]);

  useEffect(() => {
    const filtered = users.filter(user =>
      `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredUsers(filtered);
  }, [users, searchTerm]);

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '10'
      });

      if (roleFilter !== ALL) params.append('role', roleFilter);
      if (statusFilter !== ALL) params.append('status', statusFilter);

      const response = await API.get(`/admin/users?${params}`);
      setUsers(response.data.users || []);
      setTotalPages(response.data.totalPages || 1);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  /** Same audited endpoint as Pending Approvals; only professionals (clinician, therapist, lab) have a status. */
  const handleStatusUpdate = async (userId: string, status: 'active' | 'rejected') => {
    setBusyId(userId);
    try {
      await API.post('/admin/update-professional-status', { userId, status });
      await fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update user status');
    } finally {
      setBusyId(null);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'active': return 'bg-secondary text-primary';
      case 'pending': return 'bg-accent/10 text-accent-foreground';
      case 'rejected': return 'bg-muted text-destructive';
      default: return 'bg-muted text-foreground';
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-muted text-foreground';
      case 'clinician': return 'bg-secondary/70 text-primary';
      case 'therapist': return 'bg-secondary text-primary';
      case 'parent': return 'bg-accent/10 text-accent-foreground';
      case 'lab': return 'bg-secondary/70 text-primary';
      default: return 'bg-muted text-foreground';
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading users...</div>;
  }

  if (error) {
    return (
      <div className="text-center">
        <div className="text-destructive mb-4">{error}</div>
        <Button onClick={fetchUsers}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="clinician">Clinician</SelectItem>
                <SelectItem value="therapist">Therapist</SelectItem>
                <SelectItem value="parent">Parent</SelectItem>
                <SelectItem value="lab">Lab</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Specialization</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user._id}>
                    <TableCell className="font-medium">
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getRoleColor(user.role)}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.approvalStatus && (
                        <Badge className={getStatusColor(user.approvalStatus)}>
                          {user.approvalStatus}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{user.specialization || '-'}</TableCell>
                    <TableCell>
                      {user.role === 'parent' ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Select
                          value={user.organizationId || orgs.find((o) => o.isDefault)?._id || undefined}
                          onValueChange={(v) => void setOrganization(user._id, v)}
                          disabled={busyId === user._id || orgs.length === 0}
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue placeholder="Organisation" />
                          </SelectTrigger>
                          <SelectContent>
                            {orgs.map((o) => (
                              <SelectItem key={o._id} value={o._id}>
                                {o.code} · {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {PROFESSIONAL_ROLES.includes(user.role) && user.approvalStatus === 'pending' ? (
                          <>
                            <Button size="sm" disabled={busyId === user._id} onClick={() => handleStatusUpdate(user._id, 'active')}>
                              <CheckCircle className="mr-1 h-4 w-4" />
                              Approve
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busyId === user._id} onClick={() => handleStatusUpdate(user._id, 'rejected')}>
                              <XCircle className="mr-1 h-4 w-4" />
                              Reject
                            </Button>
                          </>
                        ) : null}
                        {PROFESSIONAL_ROLES.includes(user.role) && user.approvalStatus === 'active' ? (
                          <Button size="sm" variant="outline" disabled={busyId === user._id} onClick={() => handleStatusUpdate(user._id, 'rejected')}>
                            <Ban className="mr-1 h-4 w-4" />
                            Deactivate
                          </Button>
                        ) : null}
                        {PROFESSIONAL_ROLES.includes(user.role) && user.approvalStatus === 'rejected' ? (
                          <Button size="sm" variant="outline" disabled={busyId === user._id} onClick={() => handleStatusUpdate(user._id, 'active')}>
                            <RotateCcw className="mr-1 h-4 w-4" />
                            Reactivate
                          </Button>
                        ) : null}
                        {!PROFESSIONAL_ROLES.includes(user.role) ? <span className="text-xs text-muted-foreground">No actions</span> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="py-2 px-4">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
