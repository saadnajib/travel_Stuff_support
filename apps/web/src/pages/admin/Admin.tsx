import { useSearchParams } from 'react-router-dom';
import { AuditTab } from './AuditTab';
import { DisputesTab } from './DisputesTab';
import { KycTab } from './KycTab';
import { UsersTab } from './UsersTab';

const TABS = [
  { key: 'kyc', label: 'KYC queue' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'users', label: 'Users' },
  { key: 'audit', label: 'Audit log' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : 'kyc';

  return (
    <div className="page">
      <h1>Admin</h1>
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'kyc' && <KycTab />}
        {tab === 'disputes' && <DisputesTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}
