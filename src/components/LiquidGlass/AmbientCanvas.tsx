import React from 'react';

export const AmbientCanvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-gradient-to-br from-[#EEF5FF] via-[#F5F9FF] to-[#E6F1FE] dark:from-[#09111E] dark:via-[#0B1526] dark:to-[#0E1A2F] text-[#16243E] dark:text-[#E6EFFC] transition-colors duration-300">
      {/* Serene depth-of-field pastel light-blue ambient backdrop (pure sky hues, light on older mobile GPUs) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div
          className="absolute -top-36 -left-28 h-[340px] w-[340px] sm:h-[540px] sm:w-[540px] rounded-full opacity-60 dark:opacity-25 blur-2xl sm:blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(125,211,252,0.48) 0%, rgba(147,197,253,0.20) 52%, transparent 76%)',
          }}
        />
        <div
          className="absolute top-1/5 -right-24 h-[300px] w-[300px] sm:h-[500px] sm:w-[500px] rounded-full opacity-50 dark:opacity-20 blur-2xl sm:blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(147,197,253,0.44) 0%, rgba(186,230,253,0.18) 55%, transparent 78%)',
          }}
        />
        <div
          className="hidden sm:block absolute -bottom-44 left-1/3 h-[480px] w-[480px] rounded-full opacity-45 dark:opacity-20 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(186,230,253,0.48) 0%, rgba(224,242,254,0.20) 58%, transparent 80%)',
          }}
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">{children}</div>
    </div>
  );
};
