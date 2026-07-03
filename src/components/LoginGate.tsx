import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { defaultSettings } from '../data/seed';
import { isValidEmail } from '../lib/auth/authUtils';
import { createMemberSession } from '../lib/auth/memberSession';
import type { AppUser } from '../lib/types';

type LoginGateProps = {
  onVerified: (user: AppUser) => void;
};

export function LoginGate({ onVerified }: LoginGateProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function verifyAccess() {
    setError('');
    setIsSubmitting(true);
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      setIsSubmitting(false);
      return;
    }
    try {
      const user = await createMemberSession(email);
      onVerified(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Access could not be verified.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark">
          <ShieldCheck size={28} />
        </div>
        <h1>Official Price Comparison Tool</h1>
        <p className="subtle">
          Verified group members only. Vendor names, prices, product lists, and comparison tools are hidden until access is confirmed.
        </p>

        <label>
          Email address
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" autoComplete="email" />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="primary" disabled={isSubmitting} onClick={verifyAccess}>
          {isSubmitting ? 'Verifying access...' : 'Verify access'}
        </button>

        <div className="disclaimer">{defaultSettings.disclaimerText}</div>
      </section>
    </main>
  );
}
