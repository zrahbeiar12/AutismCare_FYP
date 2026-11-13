import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { motion } from "framer-motion";

interface Activity {
  name: string;
  type: "home" | "center";
  days: number;
  frequency: string; // e.g., "Daily", "3x per week"
  instructions: string;
}

interface Template {
  id: number;
  name: string;
  category: string;
  duration: string;
  description: string;
  activities: Activity[];
}

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" as const } },
};

const allTemplates: Template[] = [
  {
    id: 1,
    name: "Early Speech Development",
    category: "Speech Therapy",
    duration: "12 weeks",
    description: "Improve speech clarity, vocabulary, and expressive language.",
    activities: [
      {
        name: "Vocal warm-ups",
        type: "home",
        days: 5,
        frequency: "Daily",
        instructions: "Repeat simple sounds, vowels, and basic words for 10 min.",
      },
      {
        name: "Picture Naming",
        type: "center",
        days: 3,
        frequency: "3x per week",
        instructions: "Child names pictures shown by therapist to build vocabulary.",
      },
      {
        name: "Storytelling Practice",
        type: "home",
        days: 2,
        frequency: "2x per week",
        instructions: "Read a short story with child and encourage retelling.",
      },
    ],
  },
  {
    id: 2,
    name: "Social Skills & Behavior",
    category: "Behavioral Therapy",
    duration: "10 weeks",
    description: "Enhance social interaction, emotional recognition, and adaptive behaviors.",
    activities: [
      {
        name: "Emotion Identification",
        type: "home",
        days: 4,
        frequency: "Daily",
        instructions: "Show pictures of faces and ask child to identify emotions.",
      },
      {
        name: "Role-Playing",
        type: "center",
        days: 3,
        frequency: "3x per week",
        instructions: "Practice social situations with therapist and peers.",
      },
      {
        name: "Daily Routine Tracking",
        type: "home",
        days: 7,
        frequency: "Daily",
        instructions: "Child follows a daily routine checklist with guidance.",
      },
    ],
  },
  {
    id: 3,
    name: "Occupational Skills",
    category: "Occupational Therapy",
    duration: "12 weeks",
    description: "Develop fine motor, gross motor, and self-help skills.",
    activities: [
      {
        name: "Hand Coordination Exercises",
        type: "home",
        days: 5,
        frequency: "Daily",
        instructions: "Activities like stacking blocks, threading beads, or puzzles.",
      },
      {
        name: "Sensory Integration Play",
        type: "center",
        days: 3,
        frequency: "3x per week",
        instructions: "Play with textured materials, sand, water, or clay.",
      },
      {
        name: "Adaptive Skills Training",
        type: "home",
        days: 4,
        frequency: "4x per week",
        instructions: "Practice dressing, feeding, and self-care tasks.",
      },
    ],
  },
];

export function TherapyPlanTemplate() {
  const { templateId } = useParams();
  const navigate = useNavigate();

  const template = allTemplates.find((t) => t.id === Number(templateId));

  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState<number | "">("");
  const [autismLevel, setAutismLevel] = useState<"Mild" | "Moderate" | "Severe">("Mild");
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    if (template) {
      setActivities(template.activities);
    }
  }, [template]);

  if (!template) return <p className="text-center mt-10">Template not found!</p>;

  const handleActivityDaysChange = (index: number, days: number) => {
    const updated = [...activities];
    updated[index].days = days;
    setActivities(updated);
  };

  const handleSubmit = () => {
    const therapyPlan = {
      templateName: template.name,
      childName,
      childAge,
      autismLevel,
      activities,
    };
    console.log("Created Therapy Plan:", therapyPlan);
    alert("Therapy Plan Created Successfully!");
    navigate("/therapist-dashboard"); // Wapas TherapyPlans section me redirect
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h2 className="text-2xl font-bold text-primary">{template.name}</h2>
      <p className="text-foreground">{template.description}</p>

      {/* Child Info */}
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="show"
        transition={{ delay: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Child Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              type="text"
              placeholder="Child Name"
              className="w-full border px-3 py-2 rounded"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <input
              type="number"
              placeholder="Child Age"
              className="w-full border px-3 py-2 rounded"
              value={childAge}
              onChange={(e) => setChildAge(Number(e.target.value))}
            />
            <select
              className="w-full border px-3 py-2 rounded"
              value={autismLevel}
              onChange={(e) =>
                setAutismLevel(e.target.value as "Mild" | "Moderate" | "Severe")
              }
            >
              <option value="Mild">Mild</option>
              <option value="Moderate">Moderate</option>
              <option value="Severe">Severe</option>
            </select>
          </CardContent>
        </Card>
      </motion.div>

      {/* Activities */}
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="show"
        transition={{ delay: 0.4 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Activities & Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activities.map((act, idx) => (
              <div key={idx} className="flex flex-col gap-2 border-b pb-2">
                <span className="font-semibold">{act.name} ({act.type})</span>
                <span className="text-muted-foreground text-sm">Frequency: {act.frequency}</span>
                <span className="text-muted-foreground text-sm">Instructions: {act.instructions}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={act.days}
                    onChange={(e) => handleActivityDaysChange(idx, Number(e.target.value))}
                    className="w-20 border px-2 py-1 rounded"
                  />
                  <span>days</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      <Button className="w-full" variant="default" onClick={handleSubmit}>
        Create Therapy Plan
      </Button>
    </div>
  );
}
