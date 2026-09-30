<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Exception;

final class PublicShareMissingException extends \RuntimeException {
	public function __construct() {
		parent::__construct('The previous share was removed. Choose a password and expiry to recover this gallery link.');
	}
}
