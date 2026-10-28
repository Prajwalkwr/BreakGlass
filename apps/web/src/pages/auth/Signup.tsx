import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { passwordSchema, registerSchema } from '@breakglass/shared';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Field, Input, InlineNotice } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

const formSchema = registerSchema.extend({
  workspaceName: z.string().trim().max(80).optional(),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormValues = z.infer<typeof formSchema>;

export default function Signup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '', workspaceName: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setFieldErrors({});
    try {
      await api.post('/auth/register', {
        name: values.name,
        email: values.email,
        password: values.password,
        ...(values.workspaceName ? { workspaceName: values.workspaceName } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/app', { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerError(error.message);
        if (error.details?.length) {
          setFieldErrors(Object.fromEntries(error.details.map((detail) => [detail.path, detail.message])));
        }
      } else {
        setServerError('Could not create your account. Try again.');
      }
    }
  });

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Set up monitoring for your agency in under two minutes. No credit card required."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {serverError ? <InlineNotice tone="critical">{serverError}</InlineNotice> : null}

        <Field label="Your name" htmlFor="name" required error={errors.name?.message ?? fieldErrors.name}>
          <Input id="name" autoComplete="name" placeholder="Alex Rivera" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>

        <Field label="Work email" htmlFor="email" required error={errors.email?.message ?? fieldErrors.email}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@agency.com" invalid={Boolean(errors.email)} {...register('email')} />
        </Field>

        <Field label="Agency or workspace name" htmlFor="workspaceName" error={errors.workspaceName?.message}>
          <Input id="workspaceName" placeholder="Rivera Studio" {...register('workspaceName')} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="password" required error={errors.password?.message ?? fieldErrors.password}>
            <Input id="password" type="password" autoComplete="new-password" invalid={Boolean(errors.password)} {...register('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
            <Input id="confirmPassword" type="password" autoComplete="new-password" invalid={Boolean(errors.confirmPassword)} {...register('confirmPassword')} />
          </Field>
        </div>
        <p className="-mt-1 text-[12px] text-ink-400">At least 10 characters. Password managers welcome.</p>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
