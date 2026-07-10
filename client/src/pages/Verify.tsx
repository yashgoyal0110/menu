import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { AuthAside } from '../components/AuthAside'
import { Alert, Button, Card, Field, Input } from '../components/ui'
import { useAuth } from '../context/auth'

export function Verify() {
  const { verify, resend } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await verify(email, code.trim())
      navigate('/dashboard/stores')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  const onResend = async () => {
    setError(null)
    setNotice(null)
    setResending(true)
    try {
      await resend(email)
      setNotice('We sent a new code to your email.')
    } catch {
      setNotice('If that email needs verification, a new code is on its way.')
    } finally {
      setResending(false)
    }
  }

  if (!email) {
    return (
      <div className="auth-main" style={{ minHeight: '100vh' }}>
        <Card className="auth-card" pad>
          <div className="stack">
            <h1>Verify your email</h1>
            <Alert tone="error">
              Missing email address. Please sign up or sign in again.
            </Alert>
            <Link to="/sign-up">Back to sign up</Link>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <AuthAside
        headline="One quick step to secure your account."
        subtitle="We emailed you a 6-digit code. Enter it to activate your workspace."
      />

      <main className="auth-main">
        <Card className="auth-card" pad>
          <form className="stack" onSubmit={onSubmit}>
            <div className="stack-sm">
              <h1 style={{ margin: 0 }}>Verify your email</h1>
              <p className="muted" style={{ margin: 0 }}>
                We sent a 6-digit code to <strong>{email}</strong>.
              </p>
            </div>

            {error && <Alert tone="error">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <Field htmlFor="code" label="Verification code">
              <Input
                autoComplete="one-time-code"
                id="code"
                inputMode="numeric"
                maxLength={6}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="000000"
                required
                style={{
                  letterSpacing: '0.5em',
                  fontSize: '1.3rem',
                  textAlign: 'center',
                }}
                value={code}
              />
            </Field>

            <Button
              block
              disabled={code.length !== 6}
              loading={submitting}
              type="submit"
            >
              {submitting ? 'Verifying…' : 'Verify & continue'}
            </Button>

            <div className="row-between text-sm">
              <button
                className="btn btn--ghost btn--sm"
                disabled={resending}
                onClick={onResend}
                type="button"
              >
                {resending ? 'Sending…' : 'Resend code'}
              </button>
              <Link to="/sign-in">Back to sign in</Link>
            </div>
          </form>
        </Card>
      </main>
    </div>
  )
}
