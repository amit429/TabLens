import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

export const Slider = React.forwardRef<React.ComponentRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SliderPrimitive.Root ref={ref} className={cn('relative flex w-full touch-none select-none items-center h-5', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className="block size-4 rounded-full border-2 border-primary bg-card shadow-sm transition-transform hover:scale-110 cursor-grab active:cursor-grabbing"
        />
      ))}
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = 'Slider';
