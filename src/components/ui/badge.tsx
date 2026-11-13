import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 h-5 text-[11px] font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-muted text-muted-foreground',
      outline: 'border border-border text-muted-foreground',
      accent: 'bg-accent-soft text-accent',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
