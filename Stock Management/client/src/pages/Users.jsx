import { useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useToast, Modal, Alert, Loading, Field } from '../ui.jsx';
import { dateTime } from '../format';

const ROLE_HELP = {
  cashier: 'Billing, view stock and menu, switch dishes on/off',
  manager: 'Everything a cashier can do, plus stock, recipes, purchases, voids and reports',
  admin: 'Everything, plus staff accounts',
};

export default function Users() {
  const { user: me } = useApp();
  const toast = useToast();
  const q = useLoad(() => api.users());
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setEditing((u) => ({ ...u, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id, name, username, role, active, password } = editing;
      if (id) await api.updateUser(id, { name, role, active, ...(password && { password }) });
      else await api.createUser({ name, username, role, password });
      toast(`${name} saved`);
      setEditing(null);
      q.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (q.loading && !q.data) return <Loading />;
  return (
    <div className="page">
      <div className="split-head">
        <p className="muted">Each person should sign in with their own account, so bills, voids and stock changes show who did them.</p>
        <button className="btn primary" onClick={() => { setError(''); setEditing({ name: '', username: '', role: 'cashier', password: '', active: true }); }}>+ Staff member</button>
      </div>
      {q.error && <Alert>{q.error}</Alert>}
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(q.data || []).map((u) => (
                <tr key={u.id} className={u.active ? '' : 'voided'}>
                  <td className="name">{u.name}{u.id === me.id && <span className="chip">you</span>}</td>
                  <td className="mono">{u.username}</td>
                  <td><span className="chip">{u.role}</span></td>
                  <td>{u.last_login_at ? dateTime(u.last_login_at) : <span className="muted">Never</span>}</td>
                  <td>{u.active ? <span className="badge in_stock">Active</span> : <span className="badge out_of_stock">Disabled</span>}</td>
                  <td className="actions"><button className="link" onClick={() => { setError(''); setEditing({ ...u, password: '' }); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'New staff member'} onClose={() => setEditing(null)} busy={busy} size="small">
          <form className="grid one" onSubmit={save}>
            <Field label="Name"><input value={editing.name} onChange={set('name')} required maxLength={80} autoFocus /></Field>
            <Field label="Username" hint={editing.id ? 'Cannot be changed' : '3-40 letters, digits, dot, dash or underscore'}>
              <input value={editing.username} onChange={set('username')} required disabled={!!editing.id} pattern="[A-Za-z0-9._\-]{3,40}" autoComplete="off" />
            </Field>
            <Field label="Role" hint={ROLE_HELP[editing.role]}>
              <select value={editing.role} onChange={set('role')}>{Object.keys(ROLE_HELP).map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field label={editing.id ? 'Reset password' : 'Password'} hint={editing.id ? 'Leave blank to keep. Resetting signs them out everywhere.' : 'At least 8 characters'}>
              <input type="password" value={editing.password} onChange={set('password')} minLength={8} required={!editing.id} autoComplete="new-password" />
            </Field>
            {editing.id && editing.id !== me.id && <label className="check"><input type="checkbox" checked={editing.active} onChange={set('active')} /> Account active</label>}
            {error && <Alert>{error}</Alert>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
