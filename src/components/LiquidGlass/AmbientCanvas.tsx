import React from 'react';
import { useUiMode } from '../../context/UiModeContext';

export const AmbientCanvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isEthereal } = useUiMode();

  if (!isEthereal) {
    return (
      <div className="relative min-h-screen overflow-x-clip bg-gradient-to-br from-[#EEF5FF] via-[#F5F9FF] to-[#E6F1FE] dark:from-[#09111E] dark:via-[#0B1526] dark:to-[#0E1A2F] text-[#16243E] dark:text-[#E6EFFC] transition-colors duration-300">
        {/* Serene depth-of-field pastel light-blue ambient backdrop (Classic UI) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
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
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-gradient-to-br from-[#DFE4FF] via-[#ECEFFF] to-[#F2E6FF] dark:from-[#080B1A] dark:via-[#0F132B] dark:to-[#161336] text-[#171B3A] dark:text-[#EEF1FF] transition-colors duration-300">
      {/* Dreamy Ethereal Liquid Glass & Floating 3D-inspired Geometric Ornaments */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* Soft aurora depth spheres */}
        <div
          className="absolute -top-40 -left-24 h-[420px] w-[420px] sm:h-[620px] sm:w-[620px] rounded-full opacity-70 dark:opacity-35 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(129,140,248,0.48) 0%, rgba(196,181,253,0.26) 48%, transparent 76%)',
          }}
        />
        <div
          className="absolute top-[12%] -right-28 h-[360px] w-[360px] sm:h-[560px] sm:w-[560px] rounded-full opacity-65 dark:opacity-30 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(232,121,249,0.34) 0%, rgba(129,140,248,0.24) 50%, transparent 78%)',
          }}
        />
        <div
          className="hidden sm:block absolute -bottom-44 left-1/4 h-[520px] w-[520px] rounded-full opacity-55 dark:opacity-28 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(56,189,248,0.34) 0%, rgba(167,139,250,0.22) 55%, transparent 80%)',
          }}
        />

        {/* Floating sculptural torus ring (bottom-left, inspired by reference dashboard) */}
        <div className="hidden lg:block ethereal-orbit-slow absolute bottom-[18%] -left-12 w-36 h-36 rounded-full border-[14px] border-fuchsia-500/55 dark:border-fuchsia-400/35 shadow-[0_18px_38px_-10px_rgba(192,38,211,0.38),inset_0_4px_10px_rgba(255,255,255,0.55)] rotate-[-22deg] backdrop-blur-xs" />

        {/* Floating translucent prism ring (top-right) */}
        <div className="hidden lg:block ethereal-orbit-reverse absolute top-[18%] -right-10 w-40 h-40 rounded-full border-[12px] border-violet-400/45 dark:border-indigo-400/30 shadow-[0_20px_42px_-12px_rgba(124,58,237,0.34),inset_0_2px_8px_rgba(255,255,255,0.6)] rotate-[24deg] blur-[0.5px]" />

        {/* Soft frosted crystal cube (bottom-right) */}
        <div className="hidden xl:block ethereal-orbit-slow absolute bottom-[22%] right-8 w-16 h-16 rounded-2xl bg-gradient-to-br from-white/80 via-indigo-100/70 to-fuchsia-200/60 dark:from-indigo-400/25 dark:via-violet-500/20 dark:to-fuchsia-500/20 border border-white/80 dark:border-white/15 shadow-[0_16px_32px_-10px_rgba(79,70,229,0.28)] rotate-[18deg] backdrop-blur-md" />

        {/* Faceted magenta crystal gem accent (far bottom-right) */}
        <div className="hidden xl:block ethereal-orbit-reverse absolute bottom-8 right-16 w-12 h-12 rounded-xl bg-gradient-to-tr from-fuchsia-600/75 via-purple-500/70 to-pink-300/80 dark:from-fuchsia-500/45 dark:via-purple-500/40 dark:to-pink-400/45 shadow-[0_12px_28px_-6px_rgba(192,38,211,0.45)] rotate-45 opacity-80" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">{children}</div>
    </div>
  );
};
