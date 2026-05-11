import { screensService } from '../screens.service';

// Types pour les réponses API
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ScreensListResponse {
  screens: any[];
  statistics: {
    totalScreens: number;
    activeScreens: number;
    totalRevenue: number;
    monthlyRevenue: number;
    totalLoyaltyPoints: number;
    alertsCount: number;
  };
}

// Routes API pour les écrans
export const screensApi = {
  // GET /api/screens - Récupérer tous les écrans
  async getScreens(): Promise<ApiResponse<ScreensListResponse>> {
    try {
      const [screens, statistics] = await Promise.all([
        screensService.getScreens(),
        screensService.getGlobalStatistics(),
      ]);

      return {
        success: true,
        data: {
          screens,
          statistics,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/:id - Récupérer un écran par ID
  async getScreenById(id: string): Promise<ApiResponse<any>> {
    try {
      const [screen, configuration, statistics, alerts, unavailabilityPeriods] = await Promise.all([
        screensService.getScreenById(id),
        screensService.getScreenConfiguration(id),
        screensService.getScreenStatistics(id, 30),
        screensService.getScreenAlerts(id),
        screensService.getUnavailabilityPeriods(id),
      ]);

      if (!screen) {
        return {
          success: false,
          error: 'Écran non trouvé',
        };
      }

      return {
        success: true,
        data: {
          screen,
          configuration,
          statistics,
          alerts,
          unavailabilityPeriods,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // POST /api/screens - Créer un nouvel écran
  async createScreen(screenData: any): Promise<ApiResponse<any>> {
    try {
      const screen = await screensService.createScreen(screenData);

      // Créer un log d'activité
      await screensService.createActivityLog(screen.id, 'screen_created', {
        name: screen.name,
        location: screen.location,
      });

      return {
        success: true,
        data: screen,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // PUT /api/screens/:id - Mettre à jour un écran
  async updateScreen(id: string, updateData: any): Promise<ApiResponse<any>> {
    try {
      const screen = await screensService.updateScreen(id, updateData);

      // Créer un log d'activité
      await screensService.createActivityLog(id, 'screen_updated', updateData);

      return {
        success: true,
        data: screen,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // DELETE /api/screens/:id - Supprimer un écran
  async deleteScreen(id: string): Promise<ApiResponse<void>> {
    try {
      await screensService.deleteScreen(id);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // PUT /api/screens/:id/status - Changer le statut d'un écran
  async updateScreenStatus(id: string, status: string, reason?: string): Promise<ApiResponse<any>> {
    try {
      const screen = await screensService.updateScreen(id, { status });

      // Créer un log d'activité
      await screensService.createActivityLog(id, 'status_changed', {
        new_status: status,
        reason,
      });

      return {
        success: true,
        data: screen,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/:id/configuration - Récupérer la configuration d'un écran
  async getScreenConfiguration(id: string): Promise<ApiResponse<any>> {
    try {
      const configuration = await screensService.getScreenConfiguration(id);

      return {
        success: true,
        data: configuration,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // PUT /api/screens/:id/configuration - Mettre à jour la configuration d'un écran
  async updateScreenConfiguration(id: string, configData: any): Promise<ApiResponse<any>> {
    try {
      const configuration = await screensService.updateScreenConfiguration(id, configData);

      // Créer un log d'activité
      await screensService.createActivityLog(id, 'configuration_updated', configData);

      return {
        success: true,
        data: configuration,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/:id/unavailability - Récupérer les périodes d'indisponibilité
  async getUnavailabilityPeriods(screenId?: string): Promise<ApiResponse<any[]>> {
    try {
      const periods = await screensService.getUnavailabilityPeriods(screenId);

      return {
        success: true,
        data: periods,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // POST /api/screens/unavailability - Créer une période d'indisponibilité
  async createUnavailabilityPeriod(unavailabilityData: any): Promise<ApiResponse<any>> {
    try {
      const period = await screensService.createUnavailabilityPeriod(unavailabilityData);

      // Créer un log d'activité
      await screensService.createActivityLog(
        unavailabilityData.screen_id,
        'unavailability_scheduled',
        {
          start_date: unavailabilityData.start_date,
          end_date: unavailabilityData.end_date,
          reason: unavailabilityData.reason,
        },
      );

      return {
        success: true,
        data: period,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // DELETE /api/screens/unavailability/:id - Supprimer une période d'indisponibilité
  async deleteUnavailabilityPeriod(id: string): Promise<ApiResponse<void>> {
    try {
      await screensService.deleteUnavailabilityPeriod(id);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/:id/statistics - Récupérer les statistiques d'un écran
  async getScreenStatistics(id: string, days: number = 30): Promise<ApiResponse<any[]>> {
    try {
      const statistics = await screensService.getScreenStatistics(id, days);

      return {
        success: true,
        data: statistics,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/:id/alerts - Récupérer les alertes d'un écran
  async getScreenAlerts(screenId?: string, resolved?: boolean): Promise<ApiResponse<any[]>> {
    try {
      const alerts = await screensService.getScreenAlerts(screenId, resolved);

      return {
        success: true,
        data: alerts,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // PUT /api/screens/alerts/:id/resolve - Marquer une alerte comme résolue
  async resolveAlert(id: string): Promise<ApiResponse<any>> {
    try {
      const alert = await screensService.resolveAlert(id);

      return {
        success: true,
        data: alert,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/:id/activity-logs - Récupérer les logs d'activité
  async getScreenActivityLogs(id: string, limit: number = 50): Promise<ApiResponse<any[]>> {
    try {
      const logs = await screensService.getScreenActivityLogs(id, limit);

      return {
        success: true,
        data: logs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // POST /api/screens/check-status - Vérifier et mettre à jour les statuts
  async checkUnavailabilityStatus(): Promise<ApiResponse<void>> {
    try {
      await screensService.checkUnavailabilityStatus();

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },

  // GET /api/screens/statistics/global - Récupérer les statistiques globales
  async getGlobalStatistics(): Promise<ApiResponse<any>> {
    try {
      const statistics = await screensService.getGlobalStatistics();

      return {
        success: true,
        data: statistics,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  },
};
