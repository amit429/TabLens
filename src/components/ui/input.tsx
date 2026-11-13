import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-8 w-full rounded-[8px] border border-input bg-card px-2.5 text-[13px] placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-16 w-full rounded-[8px] border border-input bg-card px-2.5 py-2 text-[13px] placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 resize-none',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-medium leading-none', className)} {...props} />;
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[11px] text-muted-foreground', className)} {...props} />;
}
