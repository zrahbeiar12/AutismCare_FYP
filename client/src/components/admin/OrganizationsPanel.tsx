import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import API from '../../api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export type Organization = {
  _id: string;
  name: string;
  code: string;
  city?: string;
  isDefault?: boolean;
  staffCount?: number;
};

export async function fetchOrganizations(): Promise<Organization[]> {
  const res = await API.get('/admin/organizations');
  return (res.data?.data || []) as Organization[];
}

/**
 * Hospitals / clinics using this installation. The code prefixes every case file number registered there
 * (e.g. CHL-2026-000123), so it cannot be changed once created.
 */
export function OrganizationsPanel() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', code: '', city: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setOrgs(await fetchOrganizations());
    } catch {
      toast.error('Could not load organisations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setSaving(true);
    try {
      await API.post('/admin/organizations', { ...form, code: form.code.trim().toUpperCase() });
      toast.success('Organisation added');
      setForm({ name: '', code: '', city: '' });
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Could not add organisation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organisations</CardTitle>
          <CardDescription>
            Hospitals and clinics using AutismCare. Each child case registered at an organisation gets its next file
            number, e.g. <span className="font-mono">CODE-{new Date().getFullYear()}-000001</span>. Assign staff in User
            Management.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-right">Staff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((o) => (
                  <TableRow key={o._id}>
                    <TableCell className="font-medium">
                      {o.name}
                      {o.isDefault ? <span className="ml-2 text-xs text-muted-foreground">(default)</span> : null}
                    </TableCell>
                    <TableCell className="font-mono">{o.code}</TableCell>
                    <TableCell>{o.city || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.staffCount ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add an organisation</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Children's Hospital Lahore" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-code">Code (2–8 letters/digits)</Label>
            <Input
              id="org-code"
              value={form.code}
              maxLength={8}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              placeholder="CHL"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-city">City</Label>
            <Input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Lahore" />
          </div>
          <div className="sm:col-span-3">
            <Button type="button" disabled={saving || !form.name.trim() || form.code.length < 2} onClick={() => void create()}>
              Add organisation
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
