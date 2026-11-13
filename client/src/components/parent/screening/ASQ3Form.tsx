import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import API from "../../../api";
import { Button } from "../../ui/button";
import { ArrowLeft, ArrowRight, ClipboardCheck, Heart, Lightbulb } from "lucide-react";
import { ProgressHeader } from "./guided/ProgressHeader";
import { GuidanceCards } from "./guided/GuidanceCards";
import { GuideToggle } from "./guided/GuideToggle";
import { QuestionCard } from "./guided/QuestionCard";
import { useLanguage } from "../../../i18n/LanguageContext";
import { useOfficialTranslation } from "../../../i18n/officialQuestionnaire";
import { ReadMoreSection } from "./guided/ReadMoreSection";
import { ResumeProgressDialog } from "./guided/ResumeProgressDialog";
import { useScreeningProgress } from "./guided/useScreeningProgress";

interface ASQ3FormProps {
  child: any;
  flowContext?: any;
  onComplete: (results: any) => void;
}

const domainMeta: Record<
  string,
  {
    emoji: string;
    importance: string;
    tips: string;
    readMore: string;
    hint: string;
  }
> = {
  Communication: {
    emoji: "🧠",
    importance: "This helps understand how your child communicates and responds.",
    tips: "Observe your child during play or daily routines.",
    readMore:
      "Communication includes gestures, sounds, words, and how a child responds to others. A range of answers is normal — this is a screening, not a diagnosis.",
    hint: "If you’re unsure, think about what happens most days (not best days).",
  },
  "Gross Motor": {
    emoji: "🏃",
    importance: "This helps understand how your child moves, balances, and explores.",
    tips: "Notice climbing, walking, jumping, and play movement.",
    readMore:
      "Gross motor skills support confidence and independence. Differences can be related to many factors — strengths in other areas are common.",
    hint: "Consider typical movement on a normal day at home.",
  },
  "Fine Motor": {
    emoji: "✋",
    importance: "This helps understand hand skills used for daily activities.",
    tips: "Watch during eating, drawing, stacking, and grabbing small items.",
    readMore:
      "Fine motor skills include grasping, using utensils, and manipulating toys. Development can vary widely by interest and practice.",
    hint: "Think about how your child uses hands during play.",
  },
  "Problem Solving": {
    emoji: "🧩",
    importance: "This helps understand learning, thinking, and exploration.",
    tips: "Try a simple task and observe how your child approaches it.",
    readMore:
      "Problem solving includes matching, figuring out new actions, and learning from trial and error. Support and patience help here.",
    hint: "Notice what happens with a small prompt or example.",
  },
  "Personal-Social": {
    emoji: "💛",
    importance: "This helps understand how your child interacts and plays with others.",
    tips: "Observe sharing attention, imitation, and social play.",
    readMore:
      "Personal-social skills cover interaction, comfort seeking, and participation in routines. Many children show different social styles.",
    hint: "Answer based on everyday interactions, not rare moments.",
  },
};

export function ASQ3Form({ child, flowContext, onComplete }: ASQ3FormProps) {
  const progress = useScreeningProgress({ type: "asq", childId: child?.id, initialStep: 0 });
  const { answers, currentStep: currentDomainIndex, setAnswer, setStep } = progress;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const { t, lang } = useLanguage();
  const official = useOfficialTranslation(questionnaire?.intervalMonths ? `asq3-${questionnaire.intervalMonths}` : null, lang);
  const [loading, setLoading] = useState(true);
  const [guideMode, setGuideMode] = useState(true);
  const [activeLocalIndex, setActiveLocalIndex] = useState(0);
  const questionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const fetchQuestionnaire = async () => {
      try {
        const params = new URLSearchParams();
        params.set('dob', child.dateOfBirth);
        params.set('childId', encodeURIComponent(String(child.id)));
        if (flowContext?.flow) params.set('flow', String(flowContext.flow));
        if (flowContext?.origin) params.set('origin', String(flowContext.origin));
        if (flowContext?.skippedMchat === true) params.set('skippedMchat', 'true');
        if (flowContext?.orderFollowed === true) params.set('orderFollowed', 'true');
        if (flowContext?.orderFollowed === false) params.set('orderFollowed', 'false');
        const response = await API.get(
          `/screening/questionnaires/ASQ-3?${params.toString()}`
        );
        setQuestionnaire(response.data.data);
      } catch (error) {
        console.error('Error fetching ASQ-3 questionnaire:', error);
        toast.error('Failed to load questionnaire');
      } finally {
        setLoading(false);
      }
    };

    fetchQuestionnaire();
  }, [child.dateOfBirth]);

  // Group questions by domain
  const questionsByDomain = questionnaire?.questions?.reduce((acc: any, question: any) => {
    if (!acc[question.domain]) {
      acc[question.domain] = [];
    }
    acc[question.domain].push(question);
    return acc;
  }, {}) || {};

  const domains: string[] = useMemo(() => {
    const fromSchema = Array.isArray(questionnaire?.domains) ? questionnaire.domains : [];
    const fromQuestions = Object.keys(questionsByDomain);
    const ordered = fromSchema.length ? fromSchema.filter((d: string) => fromQuestions.includes(d)) : fromQuestions;
    return ordered.length ? ordered : fromQuestions;
  }, [questionnaire?.domains, questionsByDomain]);

  const currentDomain = domains[currentDomainIndex];
  const currentDomainQuestions = questionsByDomain[currentDomain] || [];
  const totalDomains = domains.length;

  // Check if all questions in current domain are answered
  const isDomainAnswered = currentDomainQuestions.every((question: any) => answers[question.questionId] !== undefined);

  const firstUnansweredLocalIndex = useMemo(() => {
    for (let i = 0; i < currentDomainQuestions.length; i++) {
      const q = currentDomainQuestions[i];
      if (answers[q.questionId] === undefined) return i;
    }
    return -1;
  }, [answers, currentDomainQuestions]);

  useEffect(() => {
    const nextIdx = firstUnansweredLocalIndex === -1 ? 0 : firstUnansweredLocalIndex;
    setActiveLocalIndex(nextIdx);
    requestAnimationFrame(() => {
      const el = questionRefs.current[nextIdx];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as any)?.focus?.();
    });
  }, [currentDomainIndex, firstUnansweredLocalIndex]);

  const handleAnswer = (questionId: string, value: string, localIndex: number) => {
    setAnswer(questionId, value);
    const nextIndex = Math.min(localIndex + 1, currentDomainQuestions.length - 1);
    const nextQuestion = currentDomainQuestions[nextIndex];
    const nextTarget =
      nextQuestion && answers[nextQuestion.questionId] === undefined ? nextIndex : firstUnansweredLocalIndex;
    const resolved = nextTarget === -1 ? nextIndex : nextTarget;
    setActiveLocalIndex(resolved);
    requestAnimationFrame(() => {
      const el = questionRefs.current[resolved];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as any)?.focus?.();
    });
  };

  const handleBack = () => {
    if (currentDomainIndex > 0) {
      setStep(currentDomainIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentDomainIndex < totalDomains - 1) {
      if (!isDomainAnswered) return;
      setStep(currentDomainIndex + 1);
    }
  };

  const handleSubmit = async () => {
    const finalAnswers = answers;
    const totalQuestions = questionnaire.questions.length;
    if (Object.keys(finalAnswers).length < totalQuestions) {
      toast.error('Please answer all questions before submitting');
      return;
    }

    setIsSubmitting(true);

    try {
      const responses = Object.entries(finalAnswers).map(([questionId, answer]) => ({
        questionId,
        answer,
      }));

      const res = await API.post("/screening/calculate-screening", {
        childId: child.id,
        questionnaireType: 'ASQ-3',
        dob: child.dateOfBirth,
        weeksPreterm: 0, // Default to 0 for ASQ-3
        intervalMonths: questionnaire.intervalMonths,
        responses,
        skippedMchat: flowContext?.skippedMchat === true,
        orderFollowed: typeof flowContext?.orderFollowed === 'boolean' ? flowContext.orderFollowed : undefined,
      });

      const submission = res.data.data;
      const results = {
        riskLevel: submission.riskLevel,
        type: "ASQ-3",
        date: submission.createdAt,
        scores: submission.scores,
        result: submission.result,
        resultDescription: submission.resultDescription,
        submissionId: submission.submissionId,
        decisionSupport: submission.decisionSupport || null,
        reportEmailed: submission.reportEmailed === true,
        reportEmailError: submission.reportEmailError || null,
      };
      progress.clear();
      onComplete(results);
    } catch (err) {
      console.error('Error submitting screening:', err);
      toast.error("Failed to submit screening. Check console.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <ResumeProgressDialog
        open={progress.showResumeDialog}
        onOpenChange={progress.setShowResumeDialog}
        progress={progress.resumeCandidate}
        onResume={progress.resume}
        onStartOver={progress.startOver}
      />

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold text-foreground">ASQ-3™</div>
            <div className="text-sm text-muted-foreground">
              {child?.firstName} {child?.lastName}
              {questionnaire?.intervalMonths ? (
                <span className="ml-2 text-xs text-muted-foreground">· {questionnaire.intervalMonths} months</span>
              ) : null}
            </div>
          </div>
        </div>

        <ProgressHeader
          title="Domain-by-domain screening"
          subtitle="One domain at a time. All 6 questions stay visible."
          stepLabel={`Domain ${currentDomainIndex + 1} of ${totalDomains}`}
          current={currentDomainIndex + 1}
          total={totalDomains}
        />

        <GuidanceCards
          items={[
            { tone: "friendly", title: "Calm and simple", body: "Answer what you’ve observed in daily routines." },
            { tone: "info", title: "Small steps", body: "One domain at a time keeps things focused." },
            { tone: "progress", title: "Auto-saved", body: "Your progress is saved while you answer." },
            { tone: "info", title: "Take your time", body: "Use typical behavior from recent days." },
            { tone: "friendly", title: "Great progress", body: "You’re helping build a clearer developmental picture." },
          ]}
          currentIndex={currentDomainIndex}
        />

        <GuideToggle enabled={guideMode} onChange={setGuideMode} />

        {official.missing ? (
          <p dir="auto" className="ur-text rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {t("screening.noOfficialTranslation")}
          </p>
        ) : null}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentDomainIndex}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.22 }}
            className="space-y-3"
          >
            <div className="rounded-xl border bg-card p-4">
              <div className="text-base font-semibold text-foreground">
                {domainMeta[currentDomain]?.emoji ?? "📘"} {currentDomain}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {domainMeta[currentDomain]?.importance ?? "This domain helps understand your child’s development."}
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-950">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 rounded-lg bg-white/60 p-1.5">
                  <Lightbulb className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Tips</div>
                  <div className="mt-0.5 text-xs opacity-90">
                    {domainMeta[currentDomain]?.tips ?? "Observe during play or daily routines."}
                  </div>
                </div>
              </div>
            </div>

            <ReadMoreSection label="Read more">
              {domainMeta[currentDomain]?.readMore ??
                "This is a screening tool. If results raise concerns, discuss next steps with your clinician."}
            </ReadMoreSection>

            <div className="rounded-xl border bg-card p-4">
              <div className="text-sm font-semibold text-foreground">Questions</div>
              <div className="mt-1 text-xs text-muted-foreground">Answer all 6 to continue.</div>
            </div>

            {currentDomainQuestions.map((question: any, localIndex: number) => {
              const value = answers[question.questionId];
              const answered = value !== undefined;
              const active = localIndex === activeLocalIndex;
              return (
                <QuestionCard
                  key={question.questionId}
                  indexLabel={String(localIndex + 1)}
                  text={official.item(question.questionId, question.text)}
                  value={value}
                  answered={answered}
                  active={active}
                  hint={domainMeta[currentDomain]?.hint ?? "Answer based on typical behavior lately."}
                  showHint={guideMode && active}
                  options={[
                    { value: "yes", label: official.option("yes", t("answer.yes")) },
                    { value: "sometimes", label: official.option("sometimes", t("answer.sometimes")) },
                    { value: "not-yet", label: official.option("not-yet", t("answer.notYet")) },
                  ]}
                  onSelect={(v) => handleAnswer(question.questionId, v, localIndex)}
                  containerRef={(el) => {
                    questionRefs.current[localIndex] = el;
                  }}
                />
              );
            })}
          </motion.div>
        </AnimatePresence>

        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
            <Button variant="outline" onClick={handleBack} disabled={currentDomainIndex === 0 || isSubmitting}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Previous Domain
            </Button>

            {currentDomainIndex === totalDomains - 1 ? (
              <Button
                onClick={() => handleSubmit()}
                disabled={!isDomainAnswered || isSubmitting}
                className="rounded-xl"
              >
                {isSubmitting ? "Submitting…" : "Submit"}
              </Button>
            ) : (
              <Button
                onClick={handleNext}
                disabled={!isDomainAnswered || isSubmitting}
                className="rounded-xl"
              >
                Save & Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="mx-auto mt-3 flex w-full max-w-3xl items-center justify-center text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Heart className="h-4 w-4 text-accent" />
              Take your time — your progress is saved automatically.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

