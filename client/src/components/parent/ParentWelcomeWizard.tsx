import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  ClipboardList,
  Download,
  MessageCircle,
  Sparkles,
  Users,
} from "lucide-react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Progress } from "../ui/progress";
import { cn } from "../ui/utils";

export const PARENT_WELCOME_STORAGE_KEY = "asd_parent_welcome_wizard_v1";

type Step = {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  icon: typeof Sparkles;
};

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to your parent hub",
    description:
      "This short tour explains where to find the essentials. You can skip anytime, or replay it later from Home.",
    bullets: [
      "Designed for phones, tablets, and desktop (installable as a PWA).",
      "Nothing here replaces medical advice—use it alongside your care team.",
    ],
    icon: Sparkles,
  },
  {
    id: "children",
    title: "Start with your child’s profile",
    description: "Keeping profiles up to date helps clinicians and therapists support your family.",
    bullets: [
      "Add or review children under Children & profiles.",
      "Use Child Case for therapy notes, guidance, and progress in one place.",
    ],
    icon: Users,
  },
  {
    id: "screening",
    title: "Screenings & questionnaires",
    description: "Screening tools can highlight areas to discuss with your clinician—not a diagnosis on their own.",
    bullets: [
      "Run questionnaires from Screening → Questionnaires.",
      "Optional facial screening lives under Screening → Facial screening.",
    ],
    icon: ClipboardList,
  },
  {
    id: "care",
    title: "Appointments, messages, and reports",
    description: "Stay coordinated with your care team and keep documents handy.",
    bullets: [
      "Book or track visits from Appointments.",
      "Message your team from Messages (great on mobile).",
      "Download therapy or lab summaries from Reports when available.",
    ],
    icon: CalendarDays,
  },
  {
    id: "pwa",
    title: "Install & use offline when needed",
    description:
      "On supported browsers you can install this app to your home screen for quicker access—similar to a native app.",
    bullets: [
      "Android / Chrome: Menu → Install app / Add to Home screen.",
      "iPhone / Safari: Share → Add to Home Screen.",
      "If you go offline, recently viewed pages may still be available depending on your device.",
    ],
    icon: Download,
  },
];

export interface ParentWelcomeWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When tour completes or is dismissed, persist completion so it doesn’t auto-open again. */
  persistCompletion?: boolean;
}

export function ParentWelcomeWizard({
  open,
  onOpenChange,
  persistCompletion = true,
}: ParentWelcomeWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);

  // Safety net: recover if a modal teardown leaves pointer-events disabled.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.style.pointerEvents = "auto";
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.pointerEvents = "auto";
      }
    };
  }, []);

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  const total = STEPS.length;
  const step = STEPS[stepIndex]!;
  const progress = useMemo(() => Math.round(((stepIndex + 1) / total) * 100), [stepIndex, total]);

  const markDone = useCallback(() => {
    if (persistCompletion) {
      try {
        localStorage.setItem(PARENT_WELCOME_STORAGE_KEY, "1");
      } catch {
        // ignore
      }
    }
    setStepIndex(0);
    onOpenChange(false);
  }, [onOpenChange, persistCompletion]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        markDone();
        return;
      }
      onOpenChange(true);
    },
    [markDone, onOpenChange],
  );

  const goNext = () => {
    if (stepIndex >= total - 1) {
      markDone();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, total - 1));
  };

  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const Icon = step.icon;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // Let users dismiss the tour reliably (also prevents stale modal-lock states).
        // If they want to keep it open, they can continue with Next.
        hideCloseButton={false}
        className={cn(
          "gap-0 overflow-hidden p-0 sm:max-w-lg",
          "max-h-[min(92dvh,720px)] grid-rows-[auto_1fr_auto]",
        )}
      >
        <div className="border-b bg-gradient-to-r from-primary/10 via-accent/15 to-primary/10 px-6 py-5 sm:px-8">
          <DialogHeader className="gap-3 text-left">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 border-primary/25 bg-card shadow-sm">
                <Icon className="size-6 text-primary" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-xl leading-snug tracking-tight">
                  {step.title}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </DialogDescription>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Step {stepIndex + 1} of {total}
                </span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2 bg-primary/15" />
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-6 sm:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.ul
              key={step.id}
              role="list"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="space-y-3 text-sm leading-relaxed text-foreground"
            >
              {step.bullets.map((b) => (
                <li key={b} className="flex gap-3">
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-accent shadow-sm ring-2 ring-accent/40"
                    aria-hidden
                  />
                  <span>{b}</span>
                </li>
              ))}
            </motion.ul>
          </AnimatePresence>

          {step.id === "pwa" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mt-6 flex items-start gap-3 rounded-xl border-2 border-dashed border-primary/25 bg-muted/40 p-4 text-sm text-muted-foreground"
            >
              <MessageCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p>
                Tip: after installing, open the app from your home screen for a more focused, app-like
                experience—especially helpful on smaller screens.
              </p>
            </motion.div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t bg-card/80 px-6 py-4 sm:flex-row sm:justify-between sm:px-8">
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={markDone}>
              {stepIndex === 0 ? "Skip tour" : "Close"}
            </Button>
            {stepIndex > 0 && (
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={goBack}>
                Back
              </Button>
            )}
          </div>
          <Button type="button" className="w-full sm:w-auto" onClick={goNext}>
            {stepIndex >= total - 1 ? "Get started" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
