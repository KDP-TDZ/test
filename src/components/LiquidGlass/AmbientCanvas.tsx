import React from 'react';

export const AmbientCanvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#F4F7FB] text-slate-900">
      {/* Ambient radial lighting layers */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div
          className="absolute -top-48 -left-40 h-[560px] w-[560px] rounded-full opacity-55 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(186,230,253,0.72) 0%, rgba(224,242,254,0.22) 55%, transparent 75%)',
          }}
        />
        <div
          className="absolute top-1/4 -right-32 h-[520px] w-[520px] rounded-full opacity-45 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(224,231,255,0.65) 0%, rgba(238,242,255,0.2) 55%, transparent 78%)',
          }}
        />
        <div
          className="absolute -bottom-44 left-1/3 h-[480px] w-[480px] rounded-full opacity-40 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(207,250,254,0.6) 0%, rgba(241,245,249,0.15) 60%, transparent 80%)',
          }}
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">{children}</div>
    </div>
  );
};
