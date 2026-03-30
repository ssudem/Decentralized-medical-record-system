import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Link, useNavigate } from "react-router-dom";
import {
  LogOut,
  Wallet,
  Shield,
  Menu,
  X,
  Settings,
  Building2,
  Sun,
  Moon,
} from "lucide-react";
import { useState } from "react";

export default function Navbar() {
  const {
    user,
    walletAddress,
    connectWallet,
    logout,
    isAuthenticated,
    isSuperAdmin,
    isHospitalAdmin,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const truncate = (addr) =>
    addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <nav className="sticky top-0 z-50 backdrop-blur-xl bg-surface/80 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2 group">
            <img src="/CITKLogo.png" alt="CITK log" className="w-8 h-8" />
            <span className="text-xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
              MediRecord
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-4">
            {isSuperAdmin && (
              <Link
                to="/admin"
                className="px-3 py-1.5 rounded-lg bg-warning/10 text-warning text-sm font-medium hover:bg-warning/20 transition-colors flex items-center gap-1.5"
              >
                <Settings className="w-4 h-4" /> Admin
              </Link>
            )}
            {isHospitalAdmin && (
              <Link
                to="/hospital-admin"
                className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-sm font-medium hover:bg-success/20 transition-colors flex items-center gap-1.5"
              >
                <Building2 className="w-4 h-4" /> Hospital Admin
              </Link>
            )}

            {walletAddress ? (
              <span className="px-3 py-1.5 rounded-lg bg-surface-light border border-border text-xs font-mono text-text-secondary flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                {truncate(walletAddress)}
              </span>
            ) : (
              <button
                onClick={connectWallet}
                className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors flex items-center gap-1.5"
              >
                <Wallet className="w-4 h-4" /> Connect Wallet
              </button>
            )}

            {isAuthenticated && (
              <>
                <span className="text-sm text-text-secondary">
                  <span className="text-primary capitalize">{user?.role}</span>
                </span>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg hover:bg-surface-light text-text-muted hover:text-danger transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Theme Toggle */}
            <button
              id="theme-toggle"
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-surface-light border border-border hover:border-primary/50 text-text-secondary hover:text-primary transition-all duration-200 cursor-pointer"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4 theme-toggle-icon" />
              ) : (
                <Moon className="w-4 h-4 theme-toggle-icon" />
              )}
            </button>
          </div>

          {/* Mobile toggle */}
          <div className="flex md:hidden items-center gap-2">
            {/* Theme Toggle (mobile) */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-surface-light border border-border text-text-secondary hover:text-primary transition-colors cursor-pointer"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4 theme-toggle-icon" />
              ) : (
                <Moon className="w-4 h-4 theme-toggle-icon" />
              )}
            </button>

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 text-text-secondary"
            >
              {menuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border px-4 py-3 space-y-3 bg-surface-light animate-fade-in">
          {isSuperAdmin && (
            <Link
              to="/admin"
              className="block px-3 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium"
            >
              <Settings className="w-4 h-4 inline mr-1.5" /> Admin Panel
            </Link>
          )}
          {isHospitalAdmin && (
            <Link
              to="/hospital-admin"
              className="block px-3 py-2 rounded-lg bg-success/10 text-success text-sm font-medium"
            >
              <Building2 className="w-4 h-4 inline mr-1.5" /> Hospital Admin
            </Link>
          )}
          {walletAddress ? (
            <p className="text-xs font-mono text-text-secondary flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-primary" />{" "}
              {truncate(walletAddress)}
            </p>
          ) : (
            <button
              onClick={connectWallet}
              className="w-full text-left px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm"
            >
              Connect Wallet
            </button>
          )}
          {isAuthenticated && (
            <>
              <p className="text-sm text-text-secondary">
                <span className="text-primary capitalize">{user?.role}</span>
              </p>
              <button
                onClick={handleLogout}
                className="text-sm text-danger flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
