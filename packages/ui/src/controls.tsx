import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import { useId } from 'react';

import { cn } from './cn';

/**
 * Interactive primitives.
 *
 * Every one is a real `<button>` or `<input>`. Nothing here is a `<div>` with a click
 * handler, so keyboard operation, disabled semantics and the accessibility tree come from
 * the platform rather than from us remembering to add them.
 */

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  tone?: ButtonTone;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export function Button({
  tone = 'secondary',
  fullWidth = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      // Explicit, because a `<button>` inside a form defaults to submit and a "Compare"
      // control that reloads the dashboard is a bug nobody reports, they just stop using it.
      type={type}
      className={cn(
        'uc-button uc-focusable',
        `uc-button--${tone}`,
        fullWidth && 'uc-button--full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  /**
   * Required. An icon-only control with no accessible name is an unlabelled button to
   * anything that is not a pair of eyes, so the type system asks for one rather than
   * trusting each call site to remember.
   */
  label: string;
  icon: ReactNode;
  className?: string;
}

export function IconButton({
  label,
  icon,
  type = 'button',
  className,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn('uc-icon-button uc-focusable', className)}
      {...rest}
    >
      {/* The glyph is decorative; the name is on the button. */}
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export interface TextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'id'
> {
  label: string;
  /** Hide the label visually while keeping it for assistive technology. */
  labelHidden?: boolean;
  /** Guidance shown under the field. Becomes the error when `invalid` is set. */
  message?: string;
  invalid?: boolean;
  className?: string;
}

export function TextInput({
  label,
  labelHidden = false,
  message,
  invalid = false,
  className,
  ...rest
}: TextInputProps): ReactElement {
  // A generated id keeps label and input tied together without every call site inventing
  // one, and without two inputs on a page colliding.
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <div className={cn('uc-field', className)}>
      <label className={cn('uc-field__label', labelHidden && 'uc-sr-only')} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={cn('uc-input uc-focusable', invalid && 'uc-input--invalid')}
        aria-invalid={invalid || undefined}
        aria-describedby={message ? messageId : undefined}
        {...rest}
      />
      {message ? (
        <span
          id={messageId}
          className={cn('uc-field__message', invalid && 'uc-field__message--error')}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
