import { LogOutIcon } from '../components/icons'
import { Button, Card, PageHead } from '../components/ui'
import { useAuth } from '../context/auth'

export function Account() {
  const { user, logout } = useAuth()

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <>
      <PageHead subtitle="Manage your profile" title="Account" />

      <Card>
        <div className="card-body stack">
          <div className="row" style={{ gap: '1rem' }}>
            {user?.imageUrl ? (
              <img
                alt={user.name}
                src={user.imageUrl}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                className="avatar"
                style={{ width: 56, height: 56, fontSize: '1.4rem' }}
              >
                {initial}
              </div>
            )}
            <div className="stack-sm" style={{ gap: '0.15rem' }}>
              <strong style={{ fontSize: '1.05rem' }}>
                {user?.name ?? 'Account'}
              </strong>
              <span className="muted text-sm">{user?.email}</span>
            </div>
          </div>

          <div className="stack-sm">
            <div className="row-between text-sm">
              <span className="muted">Name</span>
              <span>{user?.name ?? '—'}</span>
            </div>
            <div className="row-between text-sm">
              <span className="muted">Email</span>
              <span>{user?.email ?? '—'}</span>
            </div>
            <div className="row-between text-sm">
              <span className="muted">Account ID</span>
              <span style={{ fontFamily: 'monospace' }}>{user?.id ?? '—'}</span>
            </div>
          </div>

          <div>
            <Button onClick={() => logout()} variant="secondary">
              <LogOutIcon size={16} />
              Sign out
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
