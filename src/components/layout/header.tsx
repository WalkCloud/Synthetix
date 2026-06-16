"use client";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-card/80 dark:bg-card/80 backdrop-blur-md border-b border-border flex items-center px-8 h-16">
      <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{title}</h2>
    </header>
  );
}
