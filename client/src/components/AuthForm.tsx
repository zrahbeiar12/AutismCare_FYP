import { useState, useContext, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggleButton } from "./ui/ThemeToggleButton";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "./ui/card";
import {
  UserPlus,
  User,
  Users,
  Stethoscope,
  FlaskConical,
  LogIn,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
  XCircle,
  Upload,
  FileText,
  AlertCircle,
  Mail,
  Shield,
  Building2,
  Heart,
  Microscope,
  Brain
} from "lucide-react";
import { toast } from "sonner";
import API from "../api";
import { AuthContext } from "../context/AuthContext";
import { ImageWithFallback } from "./figma/ImageWithFallback";

type Role = "PARENT" | "CLINICIAN" | "THERAPIST" | "LAB";

const roleConfig: Record<Role, { icon: any; label: string; description: string }> = {
  PARENT: { icon: User, label: "Parent", description: "Manage your child's care" },
  CLINICIAN: { icon: Stethoscope, label: "Clinician", description: "Healthcare professional" },
  THERAPIST: { icon: Heart, label: "Therapist", description: "Specialized therapy services" },
  LAB: { icon: Microscope, label: "Laboratory", description: "Diagnostic testing" }
};

export default function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role>("PARENT");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [inlineMessage, setInlineMessage] = useState<{ type: 'success' | 'error' | null; text: string }>({ type: null, text: '' });

  const { login } = useContext(AuthContext);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors }
  } = useForm({
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
      specialization: "",
      licenseNumber: "",
      labName: "",
      accreditation: "",
      agreeToTerms: false,
      rememberMe: false
    }
  });

  const password = watch("password");

  useEffect(() => {
    reset();
    setSelectedRole("PARENT");
  }, [isLogin, reset]);

  const onSubmit = async (data: Record<string, any>) => {
    setIsSubmitting(true);
    setInlineMessage({ type: null, text: '' });
    try {
      if (isLogin) {
        // LOGIN
        await login(data.email, data.password, data.rememberMe);
        setInlineMessage({ type: 'success', text: 'Logged in successfully!' });
      } else {
        // REGISTER
        const { confirmPassword, agreeToTerms, ...payload } = data;

        if ((selectedRole === "CLINICIAN" || selectedRole === "THERAPIST") && uploadedFiles.length > 0) {
          // Use FormData for file uploads
          const formData = new FormData();
          Object.keys(payload).forEach(key => {
            formData.append(key, payload[key]);
          });
          formData.append("role", selectedRole.toLowerCase());

          uploadedFiles.forEach((file: File, index: number) => {
            formData.append("documents", file);
          });

          const res = await API.post("/auth/register", formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          });

          setInlineMessage({ type: 'success', text: res.data.message || "Account created! You can now log in." });
        } else {
          // Regular JSON request
          const res = await API.post("/auth/register", {
            ...payload,
            role: selectedRole.toLowerCase() // backend expects lowercase
          });

          setInlineMessage({ type: 'success', text: res.data.message || "Account created! You can now log in." });
        }

        // Switch to login
        setIsLogin(true);
      }
    } catch (err: any) {
      console.error(err);
      setInlineMessage({ type: 'error', text: err.response?.data?.message || "Request failed" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="ds-app-shell relative">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggleButton />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl backdrop-blur-sm">
          <CardHeader className="ds-card-header-strip text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="mb-4"
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-sm">
                <Brain size={32} className="text-primary-foreground" />
              </div>
            </motion.div>
            <CardTitle className="text-2xl font-bold text-foreground">
              {isLogin ? "Welcome Back!" : "Let's Get Started"}
            </CardTitle>
            <CardDescription className="text-lg text-muted-foreground">
              {isLogin ? "We're glad to see you again" : "Create your account to begin"}
            </CardDescription>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-2 space-y-1 text-sm text-muted-foreground"
            >
              <p>Your information is safe and secure • You can stop anytime</p>
              <p className="text-xs">This is not a diagnosis • Take your time • We're here to help</p>
            </motion.div>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            {/* LOGIN / SIGNUP TOGGLE */}
            <motion.div
              className="grid grid-cols-2 bg-muted rounded-xl mb-6 p-1 shadow-inner"
              layout
            >
              <motion.button
                type="button"
                onClick={() => setIsLogin(true)}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium transition-all ${
                  isLogin
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <LogIn size={16} />
                Login
              </motion.button>
              <motion.button
                type="button"
                onClick={() => setIsLogin(false)}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium transition-all ${
                  !isLogin
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <UserPlus size={16} />
                Sign Up
              </motion.button>
            </motion.div>

            {/* INLINE MESSAGE */}
            <AnimatePresence>
              {inlineMessage.type && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className={`p-4 rounded-lg border flex items-center gap-3 ${
                    inlineMessage.type === 'success'
                      ? 'bg-primary/20 border text-primary'
                      : 'bg-muted border text-destructive'
                  }`}
                >
                  {inlineMessage.type === 'success' ? (
                    <CheckCircle size={20} className="text-primary flex-shrink-0" />
                  ) : (
                    <AlertCircle size={20} className="text-destructive flex-shrink-0" />
                  )}
                  <p className="text-sm font-medium">{inlineMessage.text}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* REGISTER FIELDS */}
              <AnimatePresence>
                {!isLogin && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <Label className="text-xs font-bold text-muted-foreground mb-3 block">SELECT YOUR ROLE</Label>
                    <div className="grid grid-cols-1 gap-3 mb-6">
                      {Object.entries(roleConfig).map(([role, cfg]) => {
                        const Icon = cfg.icon;
                        return (
                          <motion.button
                            type="button"
                            key={role}
                            onClick={() => setSelectedRole(role as Role)}
                            className={`flex items-center gap-4 rounded-xl border-2 p-4 transition-all duration-200 ${
                              selectedRole === role
                                ? "border-primary bg-primary/10 text-foreground shadow-md ring-2 ring-ring/50"
                                : "border-border hover:border-primary/40 hover:bg-muted/50 hover:shadow-sm"
                            }`}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                          >
                            <div
                              className={`rounded-lg p-2 ${
                                selectedRole === role
                                  ? "bg-secondary text-secondary-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <Icon size={20} />
                            </div>
                            <div className="text-left">
                              <span className="text-sm font-semibold block">{cfg.label}</span>
                              <span className="text-xs text-muted-foreground">{cfg.description}</span>
                            </div>
                            {selectedRole === role && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="ml-auto"
                              >
                                <CheckCircle size={20} className="text-primary" />
                              </motion.div>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>

                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.1 }}
                      className="grid grid-cols-2 gap-4 mb-4"
                    >
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">First Name</Label>
                        <Input {...register("firstName", { required: "First name is required" })} className="h-10" />
                        {errors.firstName && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-1 mt-1"
                          >
                            <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                            <p className="text-xs text-destructive">{errors.firstName.message as string}</p>
                          </motion.div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">Last Name</Label>
                        <Input {...register("lastName", { required: "Last name is required" })} className="h-10" />
                        {errors.lastName && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-1 mt-1"
                          >
                            <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                            <p className="text-xs text-destructive">{errors.lastName.message as string}</p>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>

                    <AnimatePresence>
                      {(selectedRole === "CLINICIAN" || selectedRole === "THERAPIST") && (
                        <>
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="grid grid-cols-2 gap-4 mb-4"
                          >
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-foreground">Specialization</Label>
                              <Input
                                {...register("specialization", { required: "Specialization is required" })}
                                className="h-10"
                              />
                              {errors.specialization && (
                                <motion.div
                                  initial={{ opacity: 0, y: -5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="flex items-center gap-1 mt-1"
                                >
                                  <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                                  <p className="text-xs text-destructive">{errors.specialization.message as string}</p>
                                </motion.div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-foreground">License Number</Label>
                              <Input
                                {...register("licenseNumber", { required: "License number is required" })}
                                className="h-10"
                              />
                              {errors.licenseNumber && (
                                <motion.div
                                  initial={{ opacity: 0, y: -5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="flex items-center gap-1 mt-1"
                                >
                                  <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                                  <p className="text-xs text-destructive">{errors.licenseNumber.message as string}</p>
                                </motion.div>
                              )}
                            </div>
                          </motion.div>

                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-2 mb-4"
                          >
                            <Label className="text-sm font-medium text-foreground">Upload Documents</Label>
                            <div className="rounded-xl border-2 border-dashed border-border p-4 text-center transition-colors hover:border-primary/50">
                              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                              <p className="text-sm text-muted-foreground mb-2">Upload your license, certifications, or other documents</p>
                              <p className="text-xs text-muted-foreground mb-3">Supported formats: JPEG, PNG, PDF, DOC, DOCX (Max 5MB each)</p>
                              <input
                                type="file"
                                multiple
                                accept=".jpeg,.jpg,.png,.pdf,.doc,.docx"
                                onChange={(e) => {
                                  const files = Array.from(e.target.files || []);
                                  setUploadedFiles(files);
                                }}
                                className="hidden"
                                id="document-upload"
                              />
                              <label
                                htmlFor="document-upload"
                                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-secondary px-4 py-2 text-secondary-foreground transition-colors hover:bg-secondary/80"
                              >
                                <FileText size={16} />
                                Choose Files
                              </label>
                            </div>
                            {uploadedFiles.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {uploadedFiles.map((file: File, index: number) => (
                                  <div key={index} className="flex items-center gap-2 text-sm text-muted-foreground bg-background p-2 rounded">
                                    <FileText size={14} />
                                    <span className="truncate">{file.name}</span>
                                    <span className="text-xs text-muted-foreground">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {selectedRole === "LAB" && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="grid grid-cols-2 gap-4 mb-4"
                        >
                          <div className="space-y-2">
                            <Label className="text-sm font-medium text-foreground">Lab Name</Label>
                            <Input
                              {...register("labName", { required: "Lab name is required" })}
                              className="h-10"
                            />
                            {errors.labName && (
                              <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center gap-1 mt-1"
                              >
                                <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                                <p className="text-xs text-destructive">{errors.labName.message as string}</p>
                              </motion.div>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium text-foreground">Accreditation</Label>
                            <Input
                              {...register("accreditation", { required: "Accreditation is required" })}
                              className="h-10"
                            />
                            {errors.accreditation && (
                              <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center gap-1 mt-1"
                              >
                                <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                                <p className="text-xs text-destructive">{errors.accreditation.message as string}</p>
                              </motion.div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* EMAIL */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-2"
              >
                <Label className="text-sm font-medium text-foreground">Email Address</Label>
                <Input
                  type="email"
                  {...register("email", { required: "Email address is required" })}
                  className="h-10"
                />
                {errors.email && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-1 mt-1"
                  >
                    <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                    <p className="text-xs text-destructive">{errors.email.message as string}</p>
                  </motion.div>
                )}
              </motion.div>

              {/* PASSWORD */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="space-y-2"
              >
                <Label className="text-sm font-medium text-foreground">Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    {...register("password", {
                      required: "Password is required",
                      minLength: {
                        value: isLogin ? 1 : 8,
                        message: "Password must be at least 8 characters"
                      }
                    })}
                    className="h-10 pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-primary"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-1 mt-1"
                  >
                    <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                    <p className="text-xs text-destructive">{errors.password.message as string}</p>
                  </motion.div>
                )}
              </motion.div>

              {/* REMEMBER ME - ONLY FOR LOGIN */}
              {isLogin && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 }}
                  className="flex items-center space-x-2"
                >
                  <Controller
                    name="rememberMe"
                    control={control}
                    render={({ field }: any) => (
                      <Checkbox
                        id="rememberMe"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <Label htmlFor="rememberMe" className="text-sm font-normal">
                    Remember me
                  </Label>
                </motion.div>
              )}

              {/* CONFIRM + TERMS */}
              <AnimatePresence>
                {!isLogin && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-foreground">Confirm Password</Label>
                      <Input
                        type="password"
                        {...register("confirmPassword", {
                          validate: (v: string) => v === password || "Passwords do not match"
                        })}
                        className="h-10"
                      />
                      {errors.confirmPassword && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-1 mt-1"
                        >
                          <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                          <p className="text-xs text-destructive">{errors.confirmPassword.message as string}</p>
                        </motion.div>
                      )}
                    </div>

                    <div className="flex gap-3 items-start">
                      <Controller
                        name="agreeToTerms"
                        control={control}
                        rules={{ required: "You must agree to the terms and conditions" }}
                        render={({ field }: any) => (
                          <Checkbox
                            id="terms"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="mt-1"
                          />
                        )}
                      />
                      <div className="grid gap-1.5 leading-none">
                        <label
                          htmlFor="terms"
                          className="text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          I agree to the Terms & Privacy Policy
                        </label>
                        {errors.agreeToTerms && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-1 mt-1"
                          >
                            <AlertCircle size={12} className="text-destructive flex-shrink-0" />
                            <p className="text-xs text-destructive">{errors.agreeToTerms.message as string}</p>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* SUBMIT BUTTON */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <motion.button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-primary flex w-full items-center justify-center gap-2 px-4 py-3 text-base shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {isSubmitting ? (
                    <Loader2 className="animate-spin w-4 h-4 mr-2" />
                  ) : isLogin ? (
                    <LogIn className="w-4 h-4 mr-2" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  {isLogin ? "Login" : "Create Account"}
                </motion.button>
              </motion.div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
