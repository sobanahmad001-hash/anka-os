import Link from "next/link";
import { useRouter } from "next/router";

const adminLinks = [
  { href: "/admin/dashboard", label: "Dashboard" },
  // ... other admin links ...
  { href: "/admin/living-product-document", label: "Living Product Document" },
];

export function AdminSidebar() {
  const router = useRouter();
  return (
    <nav className="w-64 p-4 bg-gray-50 border-r min-h-screen">
      <ul className="space-y-2">
        {adminLinks.map(link => (
          <li key={link.href}>
            <Link href={link.href} legacyBehavior>
              <a className={`block px-3 py-2 rounded hover:bg-gray-200 ${router.pathname === link.href ? "bg-gray-200 font-bold" : ""}`}>{link.label}</a>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
