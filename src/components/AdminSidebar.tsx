// AdminSidebar.tsx
import React from 'react';
import { NavLink } from 'react-router-dom';

const adminLinks = [
  { name: 'Dashboard', path: '/admin' },
  { name: 'Users', path: '/admin/users' },
  { name: 'Living Product Document', path: '/admin/living-product-document' },
  // ...other links
];

export default function AdminSidebar() {
  return (
    <nav className="w-64 bg-gray-900 text-white h-full flex flex-col">
      <div className="p-4 font-bold text-xl border-b border-gray-700">
        Admin Panel
      </div>
      <ul className="flex-1 p-2 space-y-1">
        {adminLinks.map(link => (
          <li key={link.path}>
            <NavLink
              to={link.path}
              className={({ isActive }) =>
                `block px-4 py-2 rounded hover:bg-gray-800 transition ${isActive ? 'bg-gray-800 font-semibold' : ''}`
              }
            >
              {link.name}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
