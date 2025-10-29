import { Outlet } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { Plus, Database, List, Settings, ArrowLeft } from "lucide-react";
import { Footer } from "@/components/Footer";
import { TokenStatusIndicator } from "@/components/TokenStatusIndicator";
import { ConnectionErrorBanner } from "@/components/ConnectionErrorBanner";
import { useServerCapabilitiesContext } from "@/contexts/ServerCapabilitiesContext";
import vavIcon from "@/assets/v-a-v.icon.png";

const CreateLayout = () => {
  const location = useLocation();
  const { error, refresh } = useServerCapabilitiesContext();

  const navigationItems = [
    { path: "/create/jobs", label: "Jobs", icon: List },
    { path: "/create/new", label: "New Job", icon: Plus },
    { path: "/create/datasets", label: "Datasets", icon: Database },
    { path: "/create/settings", label: "Settings", icon: Settings },
  ];

  const apiUrl = localStorage.getItem('videoannotator_api_url') ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:18011';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-1">
        <div className="container mx-auto px-4 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-2">
              <Link to="/">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Viewer
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <img src={vavIcon} alt="VideoAnnotator" className="w-8 h-8" />
                <h1 className="text-3xl font-bold text-gray-900">
                  VideoAnnotator Control Panel
                </h1>
              </div>
            </div>
            <p className="text-gray-700 ml-16">
              Create and manage annotation jobs using the VideoAnnotator pipeline
            </p>
          </div>

          {/* Navigation */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <nav className="flex space-x-2">
                {navigationItems.map(({ path, label, icon: Icon }) => (
                  <Link key={path} to={path}>
                    <Button
                      variant={location.pathname === path ? "default" : "outline"}
                      className="flex items-center gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Button>
                  </Link>
                ))}
              </nav>
              <TokenStatusIndicator showDetails={true} />
            </div>
          </div>

          {/* Connection Error Banner */}
          {error && (
            <div className="mb-6">
              <ConnectionErrorBanner
                error={error}
                apiUrl={apiUrl}
                onRetry={refresh}
              />
            </div>
          )}

          {/* Content */}
          <Card className="min-h-[600px] p-6">
            <Outlet />
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default CreateLayout;