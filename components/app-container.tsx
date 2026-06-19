import type { ReactNode } from "react";

export const appContainerClassName =
  "mx-auto w-full max-w-7xl px-6 sm:px-8 lg:px-10";

type AppContainerProps = {
  children: ReactNode;
  className?: string;
};

export function AppContainer({ children, className }: AppContainerProps) {
  return (
    <div
      className={
        className
          ? `${appContainerClassName} ${className}`
          : appContainerClassName
      }
    >
      {children}
    </div>
  );
}
