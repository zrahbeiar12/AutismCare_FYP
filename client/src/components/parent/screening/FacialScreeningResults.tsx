import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { ProtectedImage } from '../../ui/ProtectedMedia';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Progress } from '../../ui/progress';
import { 
  Camera, 
  CheckCircle, 
  AlertTriangle, 
  AlertCircle, 
  Download, 
  Share2, 
  Calendar,
  Sparkles,
  TrendingUp,
  Eye,
  Smile,
  Users
} from 'lucide-react';
import { Alert, AlertDescription } from '../../ui/alert';

interface FacialScreeningResultsProps {
  results: any;
  child: any;
}

export function FacialScreeningResults({ results, child }: FacialScreeningResultsProps) {
  const navigate = useNavigate();
  /** Jump to another parent dashboard section (ParentDashboard reads `state.section`). */
  const goTo = (section: string) => navigate('/parent-dashboard', { state: { section } });
  const getRiskTone = (risk: string): 'good' | 'warn' | 'bad' | 'neutral' => {
    switch (risk) {
      case 'low':
        return 'good';
      case 'medium':
      case 'moderate':
        return 'warn';
      case 'high':
      case 'atypical':
        return 'bad';
      default:
        return 'neutral';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'normal':
        return <CheckCircle className="w-5 h-5 text-primary" />;
      case 'moderate':
        return <AlertTriangle className="w-5 h-5 text-accent" />;
      case 'atypical':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      default:
        return null;
    }
  };

  const getFeatureTone = (status: string): 'good' | 'warn' | 'bad' | 'neutral' => {
    switch (status) {
      case 'normal':
      case 'low':
        return 'good';
      case 'moderate':
      case 'medium':
        return 'warn';
      case 'atypical':
      case 'high':
        return 'bad';
      default:
        return 'neutral';
    }
  };

  const featureToneStyles = (tone: 'good' | 'warn' | 'bad' | 'neutral') => {
    switch (tone) {
      case 'good':
        return {
          iconWrap: 'bg-secondary text-primary',
          title: 'text-foreground',
          badge: 'bg-primary text-primary-foreground',
        };
      case 'warn':
        return {
          iconWrap: 'bg-accent/15 text-accent',
          title: 'text-foreground',
          badge: 'bg-accent text-accent-foreground',
        };
      case 'bad':
        return {
          iconWrap: 'bg-muted text-destructive',
          title: 'text-foreground',
          badge: 'bg-destructive text-destructive-foreground',
        };
      default:
        return {
          iconWrap: 'bg-muted text-foreground',
          title: 'text-foreground',
          badge: 'bg-muted text-foreground',
        };
    }
  };

  const tone = getRiskTone(results.riskLevel);
  const headerClass =
    tone === 'good'
      ? 'border-primary/30 bg-secondary/50'
      : tone === 'warn'
        ? 'border-accent/50 bg-accent/10'
        : tone === 'bad'
          ? 'border-destructive/40 bg-muted'
          : 'border-border bg-card';
  const badgeClass =
    tone === 'good'
      ? 'bg-primary text-primary-foreground'
      : tone === 'warn'
        ? 'bg-accent text-accent-foreground'
        : tone === 'bad'
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-muted text-foreground';

  return (
    <div className="space-y-6">
      {/* Results Header */}
      <Card className={`border-2 ${headerClass}`}>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-sm">
                <Camera className="h-8 w-8 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  Facial Screening Complete
                </CardTitle>
                <CardDescription className="mt-1">
                  AI Analysis for {child?.firstName} {child?.lastName}
                </CardDescription>
              </div>
            </div>
            <div className="text-right space-y-2">
              {results.classification && (
                <div>
                  <Badge
                    className={
                      results.classification === 'ASD'
                        ? 'bg-amber-100 text-amber-950 border-amber-200/80 mb-1'
                        : 'bg-emerald-100 text-emerald-950 border-emerald-200/80 mb-1'
                    }
                  >
                    Screening: {results.classification}
                  </Badge>
                  <p className="text-[11px] text-muted-foreground max-w-[220px] ml-auto leading-snug">
                    Not a diagnosis — model-based screening signal only.
                  </p>
                </div>
              )}
              <Badge className={`${badgeClass} mb-2`}>
                {results.riskLevel.toUpperCase()} RISK
              </Badge>
              <p className="text-xs text-muted-foreground">
                Model vs. threshold (display):{' '}
                {typeof results.confidence === 'number' ? `${results.confidence}%` : '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(results.date).toLocaleDateString()}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg overflow-hidden border-2">
              <ProtectedImage
                src={results.image}
                alt="Analyzed photo"
                className="w-full h-48 object-cover"
              />
            </div>
            <div className="flex flex-col justify-center space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Overall Analysis Score</p>
                <div className="flex items-center gap-3">
                  <Progress value={results.overallScore} className="h-3 flex-1" />
                  <span className="text-xl font-bold text-foreground">
                    {results.overallScore}%
                  </span>
                </div>
              </div>
              <Alert className="border-border bg-card">
                <Sparkles className="h-4 w-4 text-accent" />
                <AlertDescription className="text-foreground text-sm">
                  {typeof results.confidence === 'number'
                    ? `Analysis finished; separation score ${results.confidence}% (from model output, not a clinical certainty).`
                    : 'Analysis finished; see probability and threshold above for the model signal.'}
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feature Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Detailed Feature Analysis
          </CardTitle>
          <CardDescription>
            AI assessment of developmental markers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(results.features).map(([key, feature]: [string, any]) => {
            const featureTone = getFeatureTone(feature.status);
            const styles = featureToneStyles(featureTone);
            const icons: { [key: string]: any } = {
              eyeContact: Eye,
              facialSymmetry: Smile,
              facialExpressions: Smile,
              socialEngagement: Users,
            };
            const Icon = icons[key] || CheckCircle;

            return (
              <div key={key} className="p-4 rounded-lg border hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${styles.iconWrap}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className={`${styles.title} capitalize`}>
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </h4>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className={`${styles.badge} mb-1`}>
                      {feature.status}
                    </Badge>
                    <p className="text-sm text-foreground">{feature.score}%</p>
                  </div>
                </div>
                <Progress value={feature.score} className="h-2" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* AI Insights */}
      <Card className="border-2 border-border bg-secondary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Sparkles className="w-5 h-5" />
            AI-Powered Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <h4 className="text-foreground">Recommendations:</h4>
            <ul className="space-y-2">
              {results.recommendations.map((rec: string, index: number) => (
                <li key={index} className="flex gap-2 text-foreground">
                  <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-card">
                    <span className="text-xs text-primary">{index + 1}</span>
                  </div>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>

          <Alert className="mt-4 border-border bg-card">
            <AlertCircle className="h-4 w-4 text-primary" />
            <AlertDescription className="text-foreground text-sm">
              This facial analysis is a screening tool and not a diagnostic assessment. 
              Please consult with a healthcare professional for comprehensive evaluation.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary">
            Next Steps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button
              variant="accent"
              className="h-auto py-6 flex-col gap-2"
              onClick={() => goTo('book-appointment')}
            >
              <Calendar className="w-6 h-6" />
              <span>Schedule Appointment</span>
              <span className="text-xs opacity-90">with a Specialist</span>
            </Button>

            <Button
              className="h-auto py-6 flex-col gap-2 rounded-xl bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
              onClick={() => goTo('screening-questionnaires')}
            >
              <TrendingUp className="w-6 h-6" />
              <span>Complete Full Screening</span>
              <span className="text-xs opacity-90">M-CHAT-R or ASQ-3</span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-6 flex-col gap-2 border-2"
              onClick={() => window.print()}
            >
              <Download className="w-6 h-6" />
              <span>Download Report</span>
              <span className="text-xs opacity-90">Print or save as PDF</span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-6 flex-col gap-2 border-2"
              onClick={() => goTo('messages')}
            >
              <Share2 className="w-6 h-6" />
              <span>Message your care team</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-sm">
          <p className="font-medium mb-1">Important Notice:</p>
          This AI-powered facial screening is a preliminary assessment tool and should not replace 
          professional medical diagnosis. Results should be reviewed by qualified healthcare professionals.
        </AlertDescription>
      </Alert>
    </div>
  );
}
