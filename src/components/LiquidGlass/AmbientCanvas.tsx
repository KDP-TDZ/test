import React from 'react';

export const AmbientCanvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#F4F7FC] dark:bg-[#0B1220] text-[#17243A] dark:text-[#E5EDF9] transition-colors duration-300">
      {/* Ambient radial lighting layers */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div
          className="absolute -top-48 -left-40 h-[560px] w-[560px] rounded-full opacity-55 dark:opacity-25 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(56,189,248,0.48) 0%, rgba(37,99,235,0.16) 55%, transparent 75%)',
          }}
        />
        <div
          className="absolute top-1/4 -right-32 h-[520px] w-[520px] rounded-full opacity-45 dark:opacity-20 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(96,165,250,0.45) 0%, rgba(129,140,248,0.15) 55%, transparent 78%)',
          }}
        />
        <div
          className="absolute -bottom-44 left-1/3 h-[480px] w-[480px] rounded-full opacity-40 dark:opacity-20 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(56,189,248,0.38) 0%, rgba(241,245,249,0.12) 60%, transparent 80%)',
          }}
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">{children}</div>
    </div>
  );
};
