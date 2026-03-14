import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Desktop from './pages/Desktop.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div style={{
      height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--anka-bg-primary)',
    }}>
      <div className="anka-fade-in" style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 20,
          background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Anka OS
        </div>
        <div style={{
          width: 28, height: 28, margin: '0 auto',
          border: '2.5px solid var(--anka-accent-muted)',
          borderTopColor: 'var(--anka-accent)',
          borderRadius: '50%', animation: 'anka-spin 0.8s linear infinite',
        }} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Desktop />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
