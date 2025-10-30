import { Dispatch, SetStateAction, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, Upload, Play, X, AlertCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { apiClient } from "@/api/client";
import { handleAPIError } from "@/api/handleError";
import { parseApiError } from "@/lib/errorHandling";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import type { ParsedError } from "@/types/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import vavIcon from "@/assets/v-a-v.icon.png";
import { usePipelineCatalog, useRefreshPipelineCatalog } from "@/hooks/usePipelineCatalog";
import { DynamicPipelineParameters } from "@/components/DynamicPipelineParameters";
import type { PipelineDescriptor } from "@/types/pipelines";
import { useConfigValidation } from "@/hooks/useConfigValidation";
import { ConfigValidationPanel } from "@/components/ConfigValidationPanel";

// Wizard steps
const STEPS = [
  { id: 1, title: "Upload Videos", description: "Select video files to process" },
  { id: 2, title: "Select Pipelines", description: "Choose annotation pipelines" },
  { id: 3, title: "Configure", description: "Set pipeline parameters" },
  { id: 4, title: "Review & Submit", description: "Review and start jobs" },
];

const buildPipelineDefaults = (pipeline: PipelineDescriptor) => {
  if (!pipeline.parameters || pipeline.parameters.length === 0) {
    return null;
  }

  const pipelineConfig: Record<string, unknown> = {};

  pipeline.parameters.forEach((param) => {
    if (param.default !== undefined) {
      pipelineConfig[param.name] = param.default;
    }
  });

  return Object.keys(pipelineConfig).length > 0 ? pipelineConfig : null;
};

const buildDefaultConfig = (pipelines: PipelineDescriptor[]) => {
  return pipelines.reduce<Record<string, unknown>>((acc, pipeline) => {
    const defaults = buildPipelineDefaults(pipeline);
    if (defaults) {
      acc[pipeline.id] = defaults;
    }
    return acc;
  }, {});
};

// Type for retry state passed via React Router
interface RetryJobState {
  retryJobId: string;
  retryJobConfig?: Record<string, unknown>;
  retryJobPipelines?: string[];
  retryJobVideoFilename?: string;
}

const CreateNewJob = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const retryState = location.state as RetryJobState | undefined;

  const { data: catalogData, isLoading: catalogLoading, error: catalogError } = usePipelineCatalog();
  const refreshPipelineCatalog = useRefreshPipelineCatalog();
  const pipelines = catalogData?.catalog.pipelines ?? [];

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ParsedError | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string[]>([]);
  const [showWarningDialog, setShowWarningDialog] = useState(false);

  // Real-time configuration validation
  const { validationResult, isValidating, validateConfig } = useConfigValidation();

  const defaultSelectedPipelines = useMemo(
    () => pipelines.filter((pipeline) => pipeline.defaultEnabled !== false).map((pipeline) => pipeline.id),
    [pipelines]
  );

  useEffect(() => {
    if (!pipelines.length) {
      return;
    }

    setSelectedPipelines((prev) => (prev.length ? prev : defaultSelectedPipelines));
    setConfig((prev) => {
      const nextConfig: Record<string, unknown> = { ...prev };

      pipelines.forEach((pipeline) => {
        if (!nextConfig[pipeline.id]) {
          const defaults = buildPipelineDefaults(pipeline);
          if (defaults) {
            nextConfig[pipeline.id] = defaults;
          }
        }
      });

      return Object.keys(nextConfig).length ? nextConfig : buildDefaultConfig(pipelines);
    });
  }, [pipelines, defaultSelectedPipelines]);

  // Handle retry state - pre-fill form with failed job's configuration
  useEffect(() => {
    if (retryState && pipelines.length) {
      if (retryState.retryJobPipelines) {
        setSelectedPipelines(retryState.retryJobPipelines);
      }
      if (retryState.retryJobConfig) {
        setConfig(retryState.retryJobConfig);
      }
      // Clear the state after using it to prevent re-filling on navigation
      window.history.replaceState({}, document.title);
    }
  }, [retryState, pipelines]);

  // Validate config whenever it changes
  useEffect(() => {
    if (Object.keys(config).length > 0) {
      validateConfig(config);
    }
  }, [config, validateConfig]);

  const progress = (currentStep / STEPS.length) * 100;

  const nextStep = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmitJobs = () => {
    // Check for warnings before submitting
    if (validationResult?.warnings && validationResult.warnings.length > 0) {
      setShowWarningDialog(true);
      return;
    }

    // No warnings, proceed directly
    performActualSubmission();
  };

  const performActualSubmission = async () => {
    console.log('🚀 Submit button clicked - starting job submission');
    console.log('Selected files:', selectedFiles.map(f => f.name));
    console.log('Selected pipelines:', selectedPipelines);
    console.log('Config:', config);

    if (selectedFiles.length === 0) {
      setSubmitError(parseApiError("No videos selected"));
      return;
    }

    if (selectedPipelines.length === 0) {
      setSubmitError(parseApiError("No pipelines selected"));
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess([]);

    const jobIds: string[] = [];
    const errors: string[] = [];
    const effectiveConfigEntries = Object.entries(config).filter(([pipelineId]) =>
      selectedPipelines.includes(pipelineId)
    );
    const effectiveConfig = effectiveConfigEntries.length > 0 ? Object.fromEntries(effectiveConfigEntries) : undefined;

    try {
      console.log(`📤 Submitting ${selectedFiles.length} job(s) to VideoAnnotator API...`);

      // Submit each video as a separate job
      for (const file of selectedFiles) {
        try {
          console.log(`📹 Submitting job for: ${file.name}`);
          const response = await apiClient.submitJob(
            file,
            selectedPipelines,
            effectiveConfig
          );
          console.log(`✅ Job created successfully: ${response.id}`);
          jobIds.push(response.id);
        } catch (error) {
          console.error(`❌ Job submission failed for ${file.name}:`, error);
          const parsedError = parseApiError(error);
          errors.push(`${file.name}: ${parsedError.message}`);
        }
      }

      if (jobIds.length > 0) {
        setSubmitSuccess(jobIds);

        // If all jobs succeeded, navigate to jobs list after a delay
        if (errors.length === 0) {
          setTimeout(() => {
            navigate('/create/jobs');
          }, 2000);
        }
      }

      if (errors.length > 0) {
        console.warn(`⚠️ Some jobs failed: ${errors.length} out of ${selectedFiles.length}`);
        setSubmitError(parseApiError({
          error: `Failed to submit ${errors.length} job(s)`,
          hint: `${errors.join('\n')}`
        }));
      }

      if (jobIds.length === 0 && errors.length > 0) {
        console.error('❌ All job submissions failed');
        setSubmitError(parseApiError({
          error: 'All job submissions failed',
          hint: 'Common issues:\n• VideoAnnotator API server not running (check http://localhost:18011)\n• Invalid API token or authentication\n• Network connectivity issues',
          error_code: 'ALL_JOBS_FAILED'
        }));
      }
    } catch (error) {
      console.error('💥 Unexpected error during job submission:', error);
      setSubmitError(parseApiError(error));
    } finally {
      setIsSubmitting(false);
      console.log('🏁 Job submission process completed');
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <VideoUploadStep
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
          />
        );
      case 2:
        return (
          <PipelineSelectionStep
            pipelines={pipelines}
            selectedPipelines={selectedPipelines}
            setSelectedPipelines={setSelectedPipelines}
            isLoading={catalogLoading}
            error={catalogError}
            onRetry={() => refreshPipelineCatalog({ forceServerRefresh: true })}
          />
        );
      case 3:
        return (
          <ConfigurationStep
            config={config}
            setConfig={setConfig}
            selectedPipelines={selectedPipelines}
            pipelines={pipelines}
            validationResult={validationResult}
            isValidating={isValidating}
          />
        );
      case 4:
        return (
          <ReviewStep
            selectedFiles={selectedFiles}
            selectedPipelines={selectedPipelines}
            config={config}
            onSubmit={handleSubmitJobs}
            isSubmitting={isSubmitting}
            submitError={submitError}
            submitSuccess={submitSuccess}
            pipelines={pipelines}
          />
        );
      default:
        return null;
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return selectedFiles.length > 0;
      case 2:
        return selectedPipelines.length > 0 && pipelines.length > 0 && !catalogLoading;
      case 3:
        // Can proceed from config step if validation passes (or is still loading)
        return validationResult?.valid !== false;
      case 4:
        // Cannot submit if config is invalid
        return validationResult?.valid !== false;
      default:
        return false;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/create/jobs">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <img src={vavIcon} alt="VideoAnnotator" className="h-8 w-8" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">Create New Annotation Jobs</h2>
            <p className="text-muted-foreground">Process videos through the VideoAnnotator pipeline (supports batch processing)</p>
          </div>
        </div>
      </div>

      {/* Retry Banner */}
      {retryState && (
        <Alert>
          <RotateCcw className="h-4 w-4" />
          <AlertTitle>Retrying Failed Job</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              <p>Job ID: <span className="font-mono text-sm">{retryState.retryJobId}</span></p>
              <p>Pipeline settings and configuration have been pre-filled.</p>
              <p className="font-semibold">
                {retryState.retryJobVideoFilename
                  ? `Please upload "${retryState.retryJobVideoFilename}" again to retry the job.`
                  : 'Please upload the same video file to retry the job.'
                }
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Progress */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>Step {currentStep} of {STEPS.length}</span>
              <span>{Math.round(progress)}% Complete</span>
            </div>
            <Progress value={progress} className="h-2" />

            <div className="flex justify-between">
              {STEPS.map((step) => (
                <div
                  key={step.id}
                  className={`text-center ${step.id === currentStep
                    ? "text-blue-600"
                    : step.id < currentStep
                      ? "text-green-600"
                      : "text-muted-foreground"
                    }`}
                >
                  <div className="text-sm font-medium">{step.title}</div>
                  <div className="text-xs">{step.description}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step Content */}
      <Card className="min-h-[400px]">
        <CardHeader>
          <CardTitle>{STEPS[currentStep - 1].title}</CardTitle>
        </CardHeader>
        <CardContent>
          {renderStepContent()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={currentStep === 1}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>

        {currentStep === STEPS.length ? (
          <Button
            onClick={handleSubmitJobs}
            disabled={isSubmitting || !canProceed()}
          >
            <Play className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Submitting...' : `Submit ${selectedFiles.length} Job${selectedFiles.length > 1 ? 's' : ''}`}
          </Button>
        ) : (
          <Button
            onClick={nextStep}
            disabled={!canProceed()}
          >
            Next
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>

      {/* Warning confirmation dialog */}
      <AlertDialog open={showWarningDialog} onOpenChange={setShowWarningDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Configuration Warnings Detected</AlertDialogTitle>
            <AlertDialogDescription>
              Your configuration has {validationResult?.warnings?.length || 0} warning(s).
              These may indicate suboptimal settings, but you can proceed if you understand the implications.
              {validationResult?.warnings && validationResult.warnings.length > 0 && (
                <div className="mt-4 space-y-2">
                  {validationResult.warnings.map((warning, idx) => (
                    <div key={idx} className="text-sm">
                      <strong className="text-yellow-700">{warning.field}:</strong> {warning.message}
                    </div>
                  ))}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowWarningDialog(false);
              performActualSubmission();
            }}>
              Submit Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// Step Components
const VideoUploadStep = ({
  selectedFiles,
  setSelectedFiles
}: {
  selectedFiles: File[];
  setSelectedFiles: (files: File[]) => void;
}) => {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setSelectedFiles([...selectedFiles, ...files]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
  };

  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-6">
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium mb-2">Upload Video Files</h3>
        <p className="text-muted-foreground mb-4">
          Select video files to process. Supports batch processing. Formats: MP4, WebM, AVI, MOV
        </p>

        <input
          type="file"
          accept="video/*"
          multiple
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="p-4 bg-green-50 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-medium text-green-800">
              Selected Files ({selectedFiles.length}):
            </h4>
            <span className="text-sm text-green-700">
              Total: {(totalSize / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {selectedFiles.map((file, index) => (
              <div key={index} className="flex justify-between items-center bg-white p-2 rounded">
                <div className="text-sm text-green-700">
                  <span className="font-medium">{file.name}</span>
                  <span className="text-gray-500 ml-2">
                    ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(index)}
                  className="h-6 w-6 p-0 text-red-600 hover:text-red-800"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const PipelineSelectionStep = ({
  pipelines,
  selectedPipelines,
  setSelectedPipelines,
  isLoading,
  error,
  onRetry
}: {
  pipelines: PipelineDescriptor[];
  selectedPipelines: string[];
  setSelectedPipelines: (pipelines: string[]) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) => {
  const groupedPipelines = useMemo(() => {
    const groups = new Map<string, PipelineDescriptor[]>();
    pipelines.forEach((pipeline) => {
      const groupKey = pipeline.group || 'Other';
      const current = groups.get(groupKey) ?? [];
      current.push(pipeline);
      groups.set(groupKey, current);
    });

    return Array.from(groups.entries())
      .map(([groupName, list]) => ({
        groupName,
        list: list.slice().sort((a, b) => a.name.localeCompare(b.name))
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  }, [pipelines]);

  const togglePipeline = (pipelineId: string) => {
    if (selectedPipelines.includes(pipelineId)) {
      setSelectedPipelines(selectedPipelines.filter((p) => p !== pipelineId));
    } else {
      setSelectedPipelines([...selectedPipelines, pipelineId]);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay error={parseApiError(error)} />
    );
  }

  if (pipelines.length === 0) {
    return (
      <Alert>
        <AlertTitle>No pipelines detected</AlertTitle>
        <AlertDescription>
          Connect to a VideoAnnotator v1.2.x server and refresh the catalog before creating jobs.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-foreground">
        Select the annotation pipelines reported by your VideoAnnotator server. Feature availability reflects
        the live API catalog.
      </p>

      <div className="space-y-6">
        {groupedPipelines.map(({ groupName, list }) => (
          <div key={groupName} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{groupName}</h3>
              <span className="text-xs text-muted-foreground">{list.length} pipelines</span>
            </div>
            <div className="space-y-3">
              {list.map((pipeline) => {
                const checked = selectedPipelines.includes(pipeline.id);
                const description = pipeline.description ?? 'No description provided.';
                return (
                  <label
                    key={pipeline.id}
                    className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition hover:border-primary/70 ${checked ? 'border-primary bg-primary/5' : 'border-border bg-card'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={checked}
                          onChange={() => togglePipeline(pipeline.id)}
                        />
                        <span className="text-sm font-medium text-foreground">{pipeline.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {pipeline.version && <span className="text-[11px] text-muted-foreground">v{pipeline.version}</span>}
                        {pipeline.model && <span className="text-[11px] text-muted-foreground">{pipeline.model}</span>}
                        {pipeline.capabilities?.length ? (
                          <span className="text-[11px] text-muted-foreground">
                            {pipeline.capabilities.length} capabilities
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedPipelines.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select at least one pipeline to proceed.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

const ConfigurationStep = ({
  config,
  setConfig,
  selectedPipelines,
  pipelines,
  validationResult,
  isValidating
}: {
  config: Record<string, unknown>;
  setConfig: Dispatch<SetStateAction<Record<string, unknown>>>;
  selectedPipelines: string[];
  pipelines: PipelineDescriptor[];
  validationResult: ReturnType<typeof useConfigValidation>['validationResult'];
  isValidating: boolean;
}) => {
  const activePipelines = useMemo(
    () => pipelines.filter((pipeline) => selectedPipelines.includes(pipeline.id)),
    [pipelines, selectedPipelines]
  );

  // Manage JSON text separately to allow editing even when temporarily invalid
  const [jsonText, setJsonText] = useState(() => JSON.stringify(config, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Sync jsonText when config changes from form controls
  useEffect(() => {
    setJsonText(JSON.stringify(config, null, 2));
  }, [config]);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Configure pipeline parameters discovered from the VideoAnnotator server. Adjust values below or
        edit the JSON override for advanced scenarios.
      </p>

      <DynamicPipelineParameters
        pipelines={pipelines}
        selectedPipelineIds={selectedPipelines}
        config={config}
        onConfigChange={setConfig}
      />

      <details className="p-4 bg-blue-50 rounded-lg">
        <summary className="font-medium text-blue-800 mb-2 cursor-pointer hover:text-blue-900">
          Advanced: Raw JSON Configuration (click to expand)
        </summary>
        <div className="mt-4 space-y-3">
          {/* Explainer */}
          <div className="p-3 bg-white border border-blue-200 rounded text-sm">
            <p className="font-semibold text-blue-900 mb-2">💡 What is this?</p>
            <p className="text-gray-700 mb-2">
              The JSON below represents your complete pipeline configuration. Each pipeline (like "openface3" or "whisper") 
              can have custom parameters. Most users can ignore this and use the form controls above.
            </p>
            <p className="text-gray-700 mb-2">
              <strong>When to use this:</strong>
            </p>
            <ul className="list-disc ml-5 space-y-1 text-gray-700">
              <li>Testing specific parameter combinations not exposed in the UI</li>
              <li>Copying/pasting configurations between jobs</li>
              <li>Applying parameters that don't have form controls yet</li>
            </ul>
            <p className="text-gray-700 mt-2">
              <strong>Example structure:</strong>
            </p>
            <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-x-auto text-gray-800">
{`{
  "openface3": {
    "model": "mobilenet",
    "confidence_threshold": 0.5
  },
  "whisper": {
    "model": "base",
    "language": "en"
  }
}`}</pre>
          </div>

          {/* JSON Editor */}
          <div className={`bg-white p-4 rounded border-2 ${validationResult?.errors && validationResult.errors.length > 0
            ? 'border-red-300 shadow-sm shadow-red-100'
            : validationResult?.warnings && validationResult.warnings.length > 0
              ? 'border-yellow-300 shadow-sm shadow-yellow-100'
              : 'border-blue-300'
            }`}>
            <div className="flex justify-between items-center mb-3">
              <div>
                <label className="text-sm font-semibold text-gray-900">
                  ✏️ Edit Configuration JSON (Editable)
                </label>
                <p className="text-xs text-gray-600 mt-0.5">
                  Click inside and type to edit the configuration directly
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(config, null, 2));
                  // Could show a toast here
                }}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Copy to clipboard
              </button>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => {
                const newText = e.target.value;
                setJsonText(newText);
                
                try {
                  const newConfig = JSON.parse(newText);
                  setConfig(newConfig);
                  setJsonError(null);
                } catch (err) {
                  // Store error but allow editing to continue
                  setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
                }
              }}
              className={`w-full h-64 text-sm font-mono resize-y border-2 rounded px-3 py-2 text-gray-900 bg-white focus:outline-none ${
                jsonError
                  ? 'border-orange-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500'
                  : validationResult?.errors && validationResult.errors.length > 0
                    ? 'border-red-400 focus:ring-2 focus:ring-red-500 focus:border-red-500'
                    : validationResult?.warnings && validationResult.warnings.length > 0
                      ? 'border-yellow-400 focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500'
                      : 'border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                }`}
              placeholder='{"pipeline_name": {"parameter": "value"}}'
            />
            <div className="mt-2 space-y-1">
              {jsonError && (
                <p className="text-xs text-orange-600 font-medium">
                  ⚠️ JSON Parse Error: {jsonError} (config will update when valid)
                </p>
              )}
              <div className="flex justify-between items-start">
                <p className="text-xs text-muted-foreground">
                  Active pipelines: {activePipelines.map((pipeline) => pipeline.name).join(', ') || 'None'}
                </p>
                {!jsonError && (
                  <p className="text-xs text-green-600">
                    ✓ Valid JSON
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* Configuration validation results */}
      <ConfigValidationPanel
        validationResult={validationResult}
        isValidating={isValidating}
      />
    </div>
  );
};

const ReviewStep = ({
  selectedFiles,
  selectedPipelines,
  config,
  onSubmit,
  isSubmitting,
  submitError,
  submitSuccess,
  pipelines
}: {
  selectedFiles: File[];
  selectedPipelines: string[];
  config: Record<string, unknown>;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitError: ParsedError | null;
  submitSuccess: string[];
  pipelines: PipelineDescriptor[];
}) => {
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const pipelineNames = selectedPipelines
    .map((pipelineId) => pipelines.find((pipeline) => pipeline.id === pipelineId)?.name || pipelineId)
    .join(", ");

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Review your job configuration before submission.
      </p>

      {submitError && (
        <ErrorDisplay error={submitError} />
      )}

      {submitSuccess.length > 0 && (
        <Alert>
          <AlertDescription>
            Successfully submitted {submitSuccess.length} job(s). Job IDs: {submitSuccess.join(", ")}
            {submitError ? "" : " Redirecting to jobs list..."}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="p-4 border rounded-lg">
          <h4 className="font-medium mb-2">Video Files ({selectedFiles.length})</h4>
          <div className="space-y-1">
            {selectedFiles.slice(0, 3).map((file, index) => (
              <p key={index} className="text-sm text-foreground">
                {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
              </p>
            ))}
            {selectedFiles.length > 3 && (
              <p className="text-sm text-muted-foreground">...and {selectedFiles.length - 3} more files</p>
            )}
            <p className="text-sm font-medium text-muted-foreground">
              Total size: {(totalSize / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
        </div>

        <div className="p-4 border rounded-lg">
          <h4 className="font-medium mb-2">Selected Pipelines</h4>
          <p>{pipelineNames || "None selected"}</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h4 className="font-medium mb-2">Estimated Processing Time</h4>
          <p>~{Math.ceil(selectedFiles.length * 7)} minutes (depending on video lengths and selected pipelines)</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h4 className="font-medium mb-2">Configuration Preview</h4>
          <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto">
            {JSON.stringify(config, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default CreateNewJob;
