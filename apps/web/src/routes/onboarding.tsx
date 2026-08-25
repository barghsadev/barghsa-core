import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

function OnboardingPage() {
  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-2xl font-bold">خوش آمدید به بارگشا</h1>
        <p className="mb-6 text-muted-foreground">
          برای شروع، لطفاً پروفایل خود را ایجاد کنید.
        </p>
        <p className="text-sm text-muted-foreground">
          Please create your profile to get started.
        </p>
        <div className="mt-8 flex flex-col gap-4">
          <div className="rounded-lg border p-4 text-left">
            <h2 className="mb-2 text-lg font-semibold">حقیقی</h2>
            <p className="text-sm text-muted-foreground">
              برای ثبت‌نام به عنوان شخص حقیقی
            </p>
            <p className="text-xs text-muted-foreground">
              Individual registration
            </p>
          </div>
          <div className="rounded-lg border p-4 text-left opacity-50">
            <h2 className="mb-2 text-lg font-semibold">حقوقی</h2>
            <p className="text-sm text-muted-foreground">
              برای ثبت‌نام به عنوان شخص حقوقی
            </p>
            <p className="text-xs text-muted-foreground">
              Legal entity registration
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
