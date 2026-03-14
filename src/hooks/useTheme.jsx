import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('anka-theme') || 'dark';
  });

  // Load preference from DB on login
  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_preferences')
      .select('theme')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.theme) {
          setThemeState(data.theme);
          localStorage.setItem('anka-theme', data.theme);
        }
      });
  }, [user]);

  // Apply theme class to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback(async (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('anka-theme', newTheme);
    if (!user) return;
    await supabase
      .from('user_preferences')
      .upsert({ user_id: user.id, theme: newTheme, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }, [user]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
