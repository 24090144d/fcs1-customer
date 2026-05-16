import { Hourglass } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F5F0E8' }}>
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ border: '1px solid #D9C8A8', background: '#FAF7F2' }}
        role="status"
        aria-live="polite"
      >
        <Hourglass size={16} className="animate-spin" style={{ color: '#1f5e57' }} />
        <span className="font-mono uppercase animate-pulse" style={{ fontSize: '0.72rem', letterSpacing: '0.12em', color: '#2f2924' }}>
          Loading...
        </span>
      </div>
    </div>
  );
}
