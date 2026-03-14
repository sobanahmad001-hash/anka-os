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
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--anka-bg-primary)]">
      <div className="text-center">
        <div className="text-4xl font-bold bg-gradient-to-r from-[var(--anka-accent)] to-purple-400 bg-clip-text text-transparent mb-4">
          Anka OS
        </div>
        <div className="w-8 h-8 border-2 border-[var(--anka-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
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
