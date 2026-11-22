import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  options: readonly CustomSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  leadingIcon?: React.ReactNode;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  leadingIcon,
  align = 'left',
  size = 'md',
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    minWidth: number;
    openUpward: boolean;
    maxHeight: number;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((opt) => opt.value === value)),
    [options, value]
  );
  const selectedOption = options[selectedIndex] ?? options[0];

  const computeCoords = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const estimatedHeight = Math.min(280, options.length * 40 + 16);
    const openUpward = spaceBelow < Math.min(estimatedHeight, 170) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(280, openUpward ? spaceAbove : spaceBelow));
    const minWidth = Math.max(rect.width, 160);
    const left =
      align === 'right'
        ? Math.max(8, Math.min(window.innerWidth - minWidth - 8, rect.right - minWidth))
        : Math.max(8, Math.min(window.innerWidth - minWidth - 8, rect.left));
    const top = openUpward ? rect.top - 6 : rect.bottom + 6;
    return { top, left, minWidth, openUpward, maxHeight };
  }, [align, options.length]);

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    const next = computeCoords();
    setCoords(next);
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [computeCoords, disabled, options.length, selectedIndex]);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        buttonRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % options.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(options.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const picked = options[activeIndex];
        if (picked) {
          onChange(picked.value);
        }
        closeMenu();
        buttonRef.current?.focus();
      }
    };

    const handleViewportChange = (e: Event) => {
      if (e.type === 'scroll' && menuRef.current?.contains(e.target as Node)) {
        return;
      }
      const updated = computeCoords();
      if (updated) {
        setCoords(updated);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [activeIndex, closeMenu, computeCoords, onChange, open, options]);

  const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (!open) {
        e.preventDefault();
        openMenu();
      }
    }
  };

  const paddingClass = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleButtonKeyDown}
        className={`w-full inline-flex items-center justify-between gap-2 rounded-xl border bg-[var(--bg-canvas)] transition-all duration-150 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${paddingClass} ${buttonClassName}`}
        style={{
          borderColor: open ? 'var(--accent)' : undefined,
          boxShadow: open ? '0 0 0 2px var(--accent-soft)' : 'none',
          color: 'var(--text-primary)',
        }}
      >
        <span className="inline-flex items-center gap-2 min-w-0 truncate">
          {leadingIcon && (
            <span className="shrink-0 opacity-80" style={{ color: 'var(--text-secondary)' }}>
              {leadingIcon}
            </span>
          )}
          <span className="truncate font-medium">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-muted)' }}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            data-myload-select-menu="true"
            aria-label={ariaLabel}
            className={`fixed z-[220] p-1.5 rounded-2xl border shadow-2xl overflow-y-auto animate-menu-open ${menuClassName}`}
            style={{
              top: coords.openUpward ? undefined : coords.top,
              bottom: coords.openUpward ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              minWidth: coords.minWidth,
              maxHeight: coords.maxHeight,
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
              transformOrigin: coords.openUpward ? 'bottom center' : 'top center',
            }}
          >
            {options.map((option, idx) => {
              const isSelected = option.value === value;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    onChange(option.value);
                    closeMenu();
                    buttonRef.current?.focus();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left text-sm transition-colors duration-100 cursor-pointer"
                  style={{
                    backgroundColor: isSelected
                      ? 'var(--accent-soft)'
                      : isActive
                        ? 'var(--bg-hover)'
                        : 'transparent',
                    color: isSelected ? 'var(--accent-text)' : 'var(--text-primary)',
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.description && (
                      <span
                        className="block truncate text-xs mt-0.5"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

