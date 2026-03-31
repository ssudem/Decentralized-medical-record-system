import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Eye, EyeOff } from "lucide-react";

export function Spinner({ size = "md", className = "" }) {
  const sizes = { sm: "w-4 h-4", md: "w-6 h-6", lg: "w-10 h-10" };
  return (
    <Loader2
      className={`animate-spin text-primary ${sizes[size]} ${className}`}
    />
  );
}

export function Card({ children, className = "", glow = false }) {
  return (
    <div
      className={`rounded-2xl bg-surface-card border border-border p-6 shadow-lg
      ${glow ? "animate-pulse-glow" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  loading = false,
  ...props
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-semibold rounded-xl px-5 py-2.5 text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
  const variants = {
    primary:
      "bg-primary text-white hover:bg-primary-light shadow-md shadow-primary/20 hover:shadow-primary/40",
    secondary:
      "bg-surface-light text-text-primary border border-border hover:border-primary/50",
    danger:
      "bg-danger/10 text-danger hover:bg-danger/20 border border-danger/20",
    ghost: "text-text-secondary hover:text-text-primary hover:bg-surface-light",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

export function Input({
  label,
  id,
  error,
  className = "",
  type = "text",
  ...props
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-text-secondary mb-1.5"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type={inputType}
          className={`w-full px-4 py-2.5 rounded-xl bg-surface-input border text-text-primary placeholder:text-text-muted
            focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all
            ${error ? "border-danger" : "border-border"} ${isPassword ? "pr-12" : ""}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center pr-4 text-text-muted hover:text-text-primary transition-colors focus:outline-none cursor-pointer"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Toast({ message, type = "success", onClose }) {
  if (!message) return null;
  const colors = {
    success: "bg-surface-card border-success/40 text-success",
    error: "bg-surface-card border-danger/40 text-danger",
    info: "bg-surface-card border-accent/40 text-accent",
  };

  const icons = {
    success: "✓",
    error: "✕",
    info: "ℹ",
  };

  const toastContent = (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-9999 w-auto max-w-md px-5 py-3 rounded-xl border-2 text-sm font-medium shadow-2xl backdrop-blur-xl animate-fade-in animate-slide-down flex items-center gap-3 ${colors[type]}`}
    >
      <span className="text-base font-bold shrink-0">{icons[type]}</span>
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 opacity-60 hover:opacity-100 cursor-pointer text-text-secondary hover:text-text-primary transition-opacity shrink-0"
      >
        ×
      </button>
    </div>
  );

  return createPortal(toastContent, document.body);
}
